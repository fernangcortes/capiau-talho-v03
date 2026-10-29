# Atalhos de teclado e perfis

O CapIAu-Talho tem um sistema central de atalhos com cinco perfis prontos e um perfil personalizado. As tabelas deste guia são geradas automaticamente a partir de `src/ui/js/keymapService.js`, a fonte única de verdade, portanto sempre refletem o que o programa faz.

## Perfis disponíveis

| Perfil | Para quem |
| :--- | :--- |
| CapIAu Padrão | Perfil nativo, pensado para corte documental rápido com a mão esquerda no teclado. É o perfil inicial. |
| Adobe Premiere Pro | Quem vem do ecossistema Adobe. |
| DaVinci Resolve | Quem vem do Resolve. |
| Apple Final Cut Pro | Quem vem do Final Cut. |
| Kdenlive | Quem vem do Kdenlive. |
| Personalizado | Mapeamento livre, definido por você. |

## Como mudar de perfil

1. Clique no botão de teclado na barra da timeline (dica: "Guia e Cheat Sheet de Atalhos").
2. No cabeçalho da janela, escolha o perfil no seletor **Perfil**.
3. A escolha fica salva no navegador e é aplicada na hora.

A janela tem três abas: **Teclado Visual & Índice Esquemático** (teclado na tela com destaque dos atalhos), **Guia Rápido Dinâmico** (lista do perfil ativo) e **Personalizar Atalhos & Tabela**.

## Como personalizar

Na aba **Personalizar Atalhos & Tabela** você grava uma nova combinação para cada comando. Ao editar, o perfil passa a ser **Personalizado**. Os botões da janela permitem exportar os atalhos para um arquivo JSON, importar um arquivo e restaurar os padrões de fábrica. A personalização fica salva localmente, no navegador.

## Regra de contexto

O mesmo atalho pode aparecer em mais de uma ação dentro de um perfil. Isso é intencional: a ação executada depende do contexto, como o painel em foco (Source, Program, timeline, biblioteca), a ferramenta ativa, o elemento sob o mouse e a presença de uma sugestão ou clipe fantasma ativo. Nas tabelas, a coluna de observação lista as ações que compartilham o atalho.

## Cartões imprimíveis

Cartões A4 de uma página, em tema claro, para imprimir ou salvar em PDF pelo navegador:

| Perfil | Cartão |
| :--- | :--- |
| CapIAu Padrão | [cartao-capiau.html](atalhos/cartao-capiau.html) |
| Adobe Premiere Pro | [cartao-premiere.html](atalhos/cartao-premiere.html) |
| DaVinci Resolve | [cartao-resolve.html](atalhos/cartao-resolve.html) |
| Apple Final Cut Pro | [cartao-finalcut.html](atalhos/cartao-finalcut.html) |
| Kdenlive | [cartao-kdenlive.html](atalhos/cartao-kdenlive.html) |

## Prevenção de conflitos de digitação

O sistema monitora o foco de digitação:

* Ao focar em caixas de texto (chatbot de IA, busca semântica, renomeação de mídias, edição de legendas e GCs), os atalhos de reprodução e de timeline ficam temporariamente suspensos.
* Ao pressionar `Esc` ou clicar fora do campo, os atalhos de edição são reativados.

## Tabelas por perfil

Gerado por `node scripts/gerar_atalhos.mjs`. Não edite o bloco abaixo à mão.

<!-- GERADO:ATALHOS:INICIO -->

### Perfil CapIAu Padrão

> Alguns atalhos aparecem em mais de uma ação neste perfil. Isso é intencional: a ação executada depende do contexto (painel em foco, ferramenta ativa, elemento sob o mouse, sugestão ou clipe fantasma ativo). A coluna de observação indica com quais ações o atalho é compartilhado.

#### 1. Reprodução & Navegação

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Espaço` | Play / Pause | Inicia ou pausa a reprodução no player ativo (Source ou Program) |
| `J` | Shuttle Reverso (J) | Reproduz para trás. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x) |
| `K` | Shuttle Play / Pause (K) | Alterna entre reproduzir e pausar a reprodução (segure K com J ou L para avançar/recuar quadro a quadro) |
| `L` | Shuttle Avanço (L) | Reproduz para frente. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x) |
| `Shift + →` | Shuttle Acelerado / Avanço Rápido (Shift + →) | Reproduz acelerado para frente. Toques repetidos aumentam a velocidade (igual JKL); segurar reproduz acelerado enquanto pressionado |
| `Shift + ←` | Shuttle Acelerado / Recuo Rápido (Shift + ←) | Reproduz acelerado para trás. Toques repetidos aumentam a velocidade reversa; segurar reproduz acelerado enquanto pressionado |
| `Ctrl + →` | Câmera Lenta Avanço (Ctrl + →) | Reproduz em câmera lenta para frente (0.25x). Segurar reproduz enquanto pressionado |
| `Ctrl + ←` | Câmera Lenta Recuo (Ctrl + ←) | Reproduz em câmera lenta reversa (-0.25x). Segurar reproduz enquanto pressionado |
| `K + J` | Jog Recuar 1 Frame (K + J) | Segure K e pressione J para recuar exatamente 1 frame |
| `K + L` | Jog Avançar 1 Frame (K + L) | Segure K e pressione L para avançar exatamente 1 frame |
| `I` | Marcar Ponto de Entrada (IN) | Define o ponto inicial de corte no Player ou Linha do Tempo |
| `O` | Marcar Ponto de Saída (OUT) | Define o ponto final de corte no Player ou Linha do Tempo |
| `Alt + I` | Limpar Ponto IN | Remove o ponto de entrada (IN) no Player ou Linha do Tempo |
| `Alt + O` | Limpar Ponto OUT | Remove o ponto de saída (OUT) no Player ou Linha do Tempo |
| `Alt + X` | Limpar Pontos IN e OUT | Remove ambos os pontos de entrada e saída (IN e OUT) |
| `X` | Marcar Clipe (IN / OUT) | Define pontos IN e OUT nos limites do clipe selecionado ou sob a agulha<br>**Atalho compartilhado, depende do contexto:** Esticar / Comprimir Taxa de Velocidade (Rate Stretch) (X). |
| `Shift + I` | Ir para o Ponto IN | Move a agulha de reprodução diretamente para o ponto IN |
| `Shift + O` | Ir para o Ponto OUT | Move a agulha de reprodução diretamente para o ponto OUT |
| `Shift + Espaço` ou `Alt + /` | Tocar de IN até OUT | Reproduz o trecho delimitado entre os pontos IN e OUT e pausa |
| `Ctrl + L` ou `Ctrl + Shift + Espaço` | Alternar Reprodução em Loop | Liga ou desliga a reprodução contínua em loop entre os pontos IN e OUT<br>**Atalho compartilhado, depende do contexto:** Desvincular Par Áudio/Vídeo (Ctrl + L). |
| `Shift + E` | Inserir na Timeline (Append) | Insere o trecho marcado (IN ➔ OUT) na timeline |
| `←` | Navegar 1 Frame para Trás | Move a agulha 1 frame para trás (quando nenhum clipe estiver selecionado)<br>**Atalho compartilhado, depende do contexto:** Nudge: Deslocar 1 Frame para Trás (←). |
| `→` | Navegar 1 Frame para Frente | Move a agulha 1 frame para frente (quando nenhum clipe estiver selecionado)<br>**Atalho compartilhado, depende do contexto:** Nudge: Deslocar 1 Frame para Frente (→). |
| `↑` ou `A` | Pular para Ponto Anterior / Início | Program: move a agulha para o corte anterior; Source: vai para IN ou Início |
| `↓` ou `S` | Pular para Próximo Ponto / Fim | Program: move a agulha para o corte seguinte; Source: vai para OUT ou Fim |
| `Ctrl + G` | Ir para Timecode / Navegação Numérica | Ativa a entrada de timecode para salto absoluto ou navegação relativa (+/- frames) |

#### 2. Ferramentas & Modos

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `V` | Ferramenta de Seleção | Ativa a ferramenta de seleção padrão da timeline (Seta) |
| `Shift + V` | Seleção por Caixa / Retângulo (Marquee) | Ativa a ferramenta de seleção por retângulo (arraste para selecionar clipes e marcadores) |
| `C` | Ferramenta Lâmina / Gilete (Blade) | Ativa a ferramenta de corte de precisão por cursor na trilha |
| `Shift + C` | Lâmina Global na Agulha | Fatia todas as pistas destravadas na coordenada da agulha de reprodução |
| `Y` | Deslizar Conteúdo Interno (Slip Tool) | Desliza os pontos IN e OUT da mídia bruta mantendo a posição e duração na timeline<br>**Atalho compartilhado, depende do contexto:** Aceitar Sugestão de IA (Y). |
| `U` | Deslizar Posição na Timeline (Slide Tool) | Move o clipe na timeline mantendo seu conteúdo intacto e compensando nos vizinhos adjacentes |
| `Shift + N` | Corte Contínuo Adjacente (Rolling Edit) | Ajusta o ponto de corte entre dois clipes contíguos sem alterar a duração total da sequência |
| `Shift + R` ou `X` | Esticar / Comprimir Taxa de Velocidade (Rate Stretch) | Altera a velocidade do clipe arrastando suas bordas para esticar ou comprimir a taxa temporal<br>**Atalho compartilhado, depende do contexto:** Marcar Clipe (IN / OUT) (X). |
| `T` | Selecionar Faixa para Frente | Ativa a ferramenta de seleção de todos os clipes à direita |
| `Shift + T` | Selecionar Faixa para Trás | Ativa a ferramenta de seleção de todos os clipes à esquerda |
| `N` ou `Shift + S` | Alternar Snapping Magnético | Liga ou desliga o alinhamento magnético inteligente de bordas e agulha<br>**Atalho compartilhado, depende do contexto:** Rejeitar Sugestão de IA (N). |
| `H` | Ferramenta Mão / Pan | Ativa a ferramenta de navegação e arrasto contínuo da timeline (Pan) |
| `Esc` | Desmarcar Seleção / Fechar Caixas | Limpa a seleção de clipes ou fecha pop-ups contextuais e modais |
| `R` | Girar Mídia sob Cursor (+90°) | Rotaciona a mídia sob o cursor (hover) na biblioteca ou no monitor de origem<br>**Atalho compartilhado, depende do contexto:** Ripple Delete (Apagar e Fechar Espaço) (R). |

#### 3. Edição, Cortes & Trims

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `,` | Inserir na Agulha (Ripple Insert) | Insere o trecho marcado no monitor Source na coordenada da agulha empurrando os clipes subsequentes |
| `.` | Sobrescrever na Agulha (Overwrite Edit) | Insere o trecho marcado no monitor Source na coordenada da agulha substituindo o material sob o intervalo |
| `Ctrl + Alt + A` | Alternar Canais na Inserção (AV / V / A) | Alterna os canais transferidos do monitor Source para a Timeline: Áudio+Vídeo (AV), Somente Vídeo (V) ou Somente Áudio (A) |
| `Alt + F` | Localizar Quadro Original na Fonte (Match Frame) | Localiza a mídia bruta correspondente ao quadro sob a agulha da timeline e abre no Source Player marcando os pontos IN–OUT originais |
| `Shift + F` | Localizar Quadro na Timeline (Reverse Match Frame) | Localiza onde o quadro atual sob a agulha do Source Player está sendo utilizado na timeline ativa e salta a agulha para a posição correspondente |
| `Ctrl + Shift + R` | Substituir Clipe na Timeline (Replace Edit) | Substitui a mídia do clipe alvo (selecionado, sob a agulha ou sob o cursor com Alt no arraste) preservando duração exata, efeitos (Ken Burns), cor e velocidade |
| `Ctrl + U` | Criar Subclipe na Biblioteca (Make Subclip) | Gera um novo item virtual na biblioteca a partir do intervalo [IN–OUT] delimitado no monitor Source |
| `Ctrl + Shift + F` | Congelar Quadro (Freeze Frame) | Captura o quadro sob a agulha e insere um segmento estático na timeline (Ctrl+Shift+F) |
| `Ctrl + R` | Velocidade / Duração do Clipe (Speed / Duration) | Abre o diálogo de velocidade percentual, duração proporcional e reversão do clipe selecionado (Ctrl+R) |
| `Ctrl + Alt + R` | Preencher Espaço na Trilha (Fit to Gap) | Estende a duração do clipe ajustando a velocidade para preencher automaticamente o espaço vazio adjacente na pista (Ctrl+Alt+R) |
| `Ctrl + Shift + D` | Crossfade de Áudio (Potência Constante) | Aplica transição de crossfade de áudio de potência constante (Equal-Power) na emenda entre clipes contíguos ou no clipe selecionado (Ctrl+Shift+D) |
| `Ctrl + D` | Transição de Vídeo Padrão (Cross Dissolve) | Aplica transição de vídeo (Cross Dissolve, Dip to Black ou Dip to White) na emenda contígua sob a agulha ou entre os clipes selecionados (Ctrl+D) |
| `Enter` | Renderizar Efeitos In para Out (Cache NLE) | Pré-renderiza o intervalo da timeline (In-Out ou trechos pesados) para playback suave em cache (Enter)<br>**Atalho compartilhado, depende do contexto:** Aceitar Sugestão de IA (Enter). |
| `E` ou `Z` ou `Alt + E` ou `Alt + Z` | Dividir Clipe no Playhead (Split) | Fatia o clipe sob a agulha de reprodução (ou o clipe selecionado) |
| `Q` | Ripple Trim Início (Até a Agulha) | Corta o início do clipe até a agulha e fecha o espaço na timeline |
| `W` | Ripple Trim Fim (Da Agulha ao Fim) | Corta da agulha até o final do clipe e fecha o espaço na timeline |
| `Del` ou `Alt + R` | Lift Delete (Apagar Clipe) | Apaga o clipe selecionado deixando o espaço vazio (gap) intacto<br>**Atalho compartilhado, depende do contexto:** Rejeitar Sugestão de IA (Del). |
| `R` ou `Backspace` ou `Shift + Del` | Ripple Delete (Apagar e Fechar Espaço) | Apaga o clipe e puxa todos os clipes posteriores para fechar a lacuna<br>**Atalho compartilhado, depende do contexto:** Girar Mídia sob Cursor (+90°) (R). |
| `Semicolon` ou `Alt + Del` | Lift no Intervalo IN–OUT | Apaga o conteúdo dentro do intervalo IN–OUT nas pistas ativas deixando o espaço vazio (gap)<br>**Atalho compartilhado, depende do contexto:** Apagar Faixa Única (Desvincular Par) (Alt + Del). |
| `Alt + Del` | Apagar Faixa Única (Desvincular Par) | Apaga apenas o vídeo ou o áudio selecionado, preservando o outro fluxo<br>**Atalho compartilhado, depende do contexto:** Lift no Intervalo IN–OUT (Alt + Del). |
| `Quote` ou `Alt + Shift + Del` | Extract (Ripple Delete) no Intervalo IN–OUT | Apaga o conteúdo dentro do intervalo IN–OUT e puxa os clipes posteriores para fechar o espaço |
| `Ctrl + L` ou `Ctrl + Shift + U` | Desvincular Par Áudio/Vídeo | Quebra a vinculação estrita entre o vídeo e seu par de áudio correspondente<br>**Atalho compartilhado, depende do contexto:** Alternar Reprodução em Loop (Ctrl + L). |
| `←` | Nudge: Deslocar 1 Frame para Trás | Move o clipe selecionado 1 frame para a esquerda na timeline<br>**Atalho compartilhado, depende do contexto:** Navegar 1 Frame para Trás (←). |
| `→` | Nudge: Deslocar 1 Frame para Frente | Move o clipe selecionado 1 frame para a direita na timeline<br>**Atalho compartilhado, depende do contexto:** Navegar 1 Frame para Frente (→). |
| `Alt + ←` ou `[` | Trim Ponto IN: Recuar 1 Frame | Expande ou contrai a ponta inicial do clipe selecionado em 1 frame<br>**Atalho compartilhado, depende do contexto:** Trim Ponto OUT: Recuar 1 Frame ([). |
| `Alt + Shift + ←` ou `[` | Trim Ponto OUT: Recuar 1 Frame | Recua a ponta final do clipe selecionado em 1 frame<br>**Atalho compartilhado, depende do contexto:** Trim Ponto IN: Recuar 1 Frame ([). |
| `Alt + →` | Trim Ponto IN: Avançar 1 Frame | Avança a ponta inicial do clipe selecionado em 1 frame |
| `Alt + Shift + →` ou `]` | Trim Ponto OUT: Avançar 1 Frame | Avança a ponta final do clipe selecionado em 1 frame |
| `D` | Selecionar Clipe sob a Agulha | Seleciona o clipe na trilha ativa posicionado sob a agulha de reprodução (D) |
| `Shift + D` | Multi-Seleção na Agulha (Adicionar à Seleção) | Seleciona todos os clipes sob a agulha em todas as pistas e adiciona à seleção existente (Shift+D) |
| `F` | Ativar / Desativar Clipe (Mute / Bypass) | Alterna se o clipe selecionado (ou sob a agulha) está ativo ou desativado |

#### 4. Marcadores

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `M` | Adicionar / Editar Marcador | Cria um novo marcador ou abre o popover de edição rápida no playhead |
| `Shift + M` | Pular para o Próximo Marcador | Avança a agulha de reprodução até o marcador seguinte na timeline |
| `Alt + M` | Pular para o Marcador Anterior | Recua a agulha de reprodução até o marcador anterior na timeline |
| `Ctrl + Shift + K` ou `Ctrl + Shift + M` | Alternar Momento Crucial (Player / Galeria) | Marca ou desmarca o quadro atual como Momento Crucial para reprodução rápida em hover |

#### 5. Assistência de IA & Tomadas

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Alt + B` | Alternar Detecção Facial no Source | Exibe ou oculta a camada visual de caixas de detecção facial e grounding no Monitor de Origem (Source) |
| `Alt + A` | Alternar Tomadas / Alternativas de IA | Abre o seletor de tomadas alternativas em clipes gerados por IA / Inspetor |
| `Enter` ou `Y` | Aceitar Sugestão de IA | Aprova a sugestão da faixa fantasma de IA, tornando-a clipe real na trilha<br>**Atalho compartilhado, depende do contexto:** Renderizar Efeitos In para Out (Cache NLE) (Enter); Deslizar Conteúdo Interno (Slip Tool) (Y). |
| `Del` ou `N` | Rejeitar Sugestão de IA | Descarta e remove a sugestão fantasma da timeline<br>**Atalho compartilhado, depende do contexto:** Lift Delete (Apagar Clipe) (Del); Alternar Snapping Magnético (N). |

#### 6. Canvas, Zoom & Histórico

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `\` ou `Shift + Z` | Ajustar Sequência na Tela (Zoom to Fit) | Enquadra perfeitamente todos os clipes na timeline ou restaura o zoom anterior (Toggle) |
| `+ / =` ou `Num +` | Aumentar Zoom na Linha do Tempo | Aproxima o zoom horizontal da régua e clipes da timeline<br>**Atalho compartilhado, depende do contexto:** Timeline: Aumentar Altura das Pistas (Num +). |
| `-` ou `Num -` | Diminuir Zoom na Linha do Tempo | Afasta o zoom horizontal da régua e clipes da timeline<br>**Atalho compartilhado, depende do contexto:** Timeline: Diminuir Altura das Pistas (Num -). |
| `Ctrl + 1` | Restaurar Zoom Padrão (1:1 / 0.5 px/f) | Restaura a escala da régua e dos clipes para o zoom padrão de 0.5 pixels por frame |
| `Ctrl + Alt + P` | Alternar 'Seleção Acompanha a Agulha' | Ativa ou desativa a seleção automática do clipe sob a agulha ao se mover |
| `Ctrl + Alt + F` | Alternar 'Timeline Segue a Agulha' (Auto-Scroll) | Ativa ou desativa a rolagem automática da timeline para acompanhar o cursor de reprodução |
| `Shift + L` | Travar / Destravar Pista Ativa (Track Lock) | Ativa ou desativa o cadeado físico de proteção total na pista selecionada |
| `Ctrl + Alt + Shift + L` | Travar / Destravar Todas as Pistas | Alterna o cadeado físico em todas as pistas de vídeo, áudio e texto da timeline |
| `Ctrl + Shift + G` | Alternar Margens de Segurança & Guias no Player (Safe Margins) | Exibe ou oculta o overlay vetorial de Action Safe (90%), Title Safe (80%), Cruz Central e Máscaras de Proporção no Monitor de Programa |
| `Ctrl + Alt + G` | Alternar Máscara de Proporção no Player (16:9 / 9:16 / 1:1 / 2.39:1) | Alterna ciclicamente entre as máscaras de proporção de aspecto (16:9, 9:16, 1:1, 2.39:1, 4:5, 4:3, Sem Máscara) no Monitor de Programa |
| `Ctrl + Z` | Desfazer Ação (Undo) | Desfaz a última alteração realizada na timeline |
| `Ctrl + Shift + Z` ou `Ctrl + Y` | Refazer Ação (Redo) | Refaz a edição desfeita anteriormente |
| `Ctrl + Shift + S` | Salvar Preset de Workspace | Abre o diálogo para salvar o layout visual atual da interface |

#### 7. Layout & Workspace (Numpad)

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Alt + Z` | Desfazer Mudança de Layout | Desfaz a última mudança na disposição dos painéis (histórico separado do da timeline) |
| `Ctrl + Alt + Shift + Z` | Refazer Mudança de Layout | Refaz a mudança de layout desfeita anteriormente |
| `Num 1` | Timeline: Expansão Direcional Esquerda | Alterna a expansão da timeline sob a sidebar esquerda (bottom-left ↔ center) |
| `Alt + Num 1` | Timeline: Toggle Cabeçalho de Pistas | Oculta ou exibe a área de faixas e timecode da timeline (Track Headers) |
| `Num 2` | Timeline: Alternar Centro ↔ Faixa Total | Alterna a timeline entre entre menus (center) e largura total na base (bottom-full) |
| `Alt + Num 2` | Timeline: Recolher / Restaurar Verticalmente | Recolhe ou expande o painel da timeline para a linha restauradora na base |
| `Ctrl + Num 2` | Timeline: Destacar / Reanexar Janela | Abre a timeline em janela flutuante para o segundo monitor ou a reanexa |
| `Num 3` | Timeline: Expansão Direcional Direita | Alterna a expansão da timeline sob a sidebar direita (bottom-right ↔ center) |
| `Alt + Num 3` | Timeline: Toggle Barra de Ferramentas | Recolhe ou expande a barra vertical de ferramentas de corte (V, C, Trims) |
| `Num 4` | Biblioteca: Ocultar / Exibir | Recolhe ou expande a sidebar esquerda (Biblioteca de mídias, temas, rostos) |
| `Alt + Num 4` | Biblioteca: Layout Estúdio (Maximizar) | Maximiza a biblioteca no layout estúdio com timeline e players empilhados |
| `Ctrl + Num 4` | Biblioteca: Destacar / Reanexar Janela | Abre a biblioteca em janela flutuante externa ou a reanexa |
| `Num 5` | Inspetor: Ocultar / Exibir | Recolhe ou expande o painel de Ajustes & Efeitos (Inspetor) |
| `Alt + Num 5` | Inspetor: Maximizar / Restaurar | Maximiza o painel de Ajustes & Efeitos no espaço disponível |
| `Ctrl + Num 5` | Inspetor: Destacar / Reanexar Janela | Abre o Inspetor em janela flutuante externa ou o reanexa |
| `Num 6` | Painel Direito: Ocultar / Exibir | Recolhe ou expande a sidebar direita (Transcrição, Visão IA, Tarefas, Logs) |
| `Alt + Num 6` | Painel Direito: Maximizar / Restaurar | Maximiza a sidebar direita no espaço disponível |
| `Ctrl + Num 6` | Painel Direito: Destacar / Reanexar Janela | Abre a sidebar direita em janela flutuante externa ou a reanexa |
| `Num 7` | Source Player: Ocultar / Exibir | Oculta ou exibe o monitor de origem (Source Player) |
| `Alt + Num 7` | Source Player: Maximizar / Restaurar | Maximiza o monitor de origem no palco central |
| `Ctrl + Num 7` | Source Player: Destacar / Reanexar Janela | Abre o monitor de origem em janela flutuante externa ou o reanexa |
| `Num 8` | Header Geral: Ocultar / Exibir | Recolhe ou expande o cabeçalho superior da aplicação para ganhar espaço vertical |
| `Num 9` | Program Player: Ocultar / Exibir | Oculta ou exibe o monitor de programa (Program Player) |
| `Alt + Num 9` | Program Player: Maximizar / Restaurar | Maximiza o monitor de programa no palco central |
| `Ctrl + Num 9` | Program Player: Destacar / Reanexar Janela | Abre o monitor de programa em janela flutuante externa ou o reanexa |
| `Num 0` | Modo Foco / Cinema / Zen | Macro global: recolhe ou restaura Header e todas as Sidebars simultaneamente |
| `Num .` | Timeline: Toggle Cabeçalho Superior | Recolhe ou restaura a barra superior de nome, zoom e sequência da timeline |
| `Num +` | Timeline: Aumentar Altura das Pistas | Aumenta a altura das faixas de áudio e vídeo na timeline (+10px)<br>**Atalho compartilhado, depende do contexto:** Aumentar Zoom na Linha do Tempo (Num +). |
| `Num -` | Timeline: Diminuir Altura das Pistas | Diminui a altura das faixas de áudio e vídeo na timeline (-10px)<br>**Atalho compartilhado, depende do contexto:** Diminuir Zoom na Linha do Tempo (Num -). |
| `Num /` | Monitores: Alternar Lado a Lado / Empilhados | Alterna a disposição dos monitores entre horizontal e vertical |
| `Num *` | Monitores: Swap / Alternar Foco | Alterna o foco ativo entre o Monitor Source e o Monitor Program |
| `Num Enter` | Maximizar / Restaurar Painel sob Foco | Maximiza ou restaura o painel ativo ou sob o cursor |
| `Ctrl + Alt + 1` ou `Ctrl + Alt + Num 1` | Workspace: Carregar Slot 1 | Carrega instantaneamente o layout salvo no slot numérico 1 (Ctrl + Alt + 1) |
| `Ctrl + Alt + 2` ou `Ctrl + Alt + Num 2` | Workspace: Carregar Slot 2 | Carrega instantaneamente o layout salvo no slot numérico 2 (Ctrl + Alt + 2) |
| `Ctrl + Alt + 3` ou `Ctrl + Alt + Num 3` | Workspace: Carregar Slot 3 | Carrega instantaneamente o layout salvo no slot numérico 3 (Ctrl + Alt + 3) |
| `Ctrl + Alt + 4` ou `Ctrl + Alt + Num 4` | Workspace: Carregar Slot 4 | Carrega instantaneamente o layout salvo no slot numérico 4 (Ctrl + Alt + 4) |
| `Ctrl + Alt + 5` ou `Ctrl + Alt + Num 5` | Workspace: Carregar Slot 5 | Carrega instantaneamente o layout salvo no slot numérico 5 (Ctrl + Alt + 5) |
| `Ctrl + Alt + 6` ou `Ctrl + Alt + Num 6` | Workspace: Carregar Slot 6 | Carrega instantaneamente o layout salvo no slot numérico 6 (Ctrl + Alt + 6) |
| `Ctrl + Alt + 7` ou `Ctrl + Alt + Num 7` | Workspace: Carregar Slot 7 | Carrega instantaneamente o layout salvo no slot numérico 7 (Ctrl + Alt + 7) |
| `Ctrl + Alt + 8` ou `Ctrl + Alt + Num 8` | Workspace: Carregar Slot 8 | Carrega instantaneamente o layout salvo no slot numérico 8 (Ctrl + Alt + 8) |
| `Ctrl + Alt + 9` ou `Ctrl + Alt + Num 9` | Workspace: Carregar Slot 9 | Carrega instantaneamente o layout salvo no slot numérico 9 (Ctrl + Alt + 9) |
| `Ctrl + Alt + Shift + 1` ou `Ctrl + Alt + Shift + Num 1` | Workspace: Salvar no Slot 1 | Grava a disposição atual diretamente no slot numérico 1 (Ctrl + Alt + Shift + 1) |
| `Ctrl + Alt + Shift + 2` ou `Ctrl + Alt + Shift + Num 2` | Workspace: Salvar no Slot 2 | Grava a disposição atual diretamente no slot numérico 2 (Ctrl + Alt + Shift + 2) |
| `Ctrl + Alt + Shift + 3` ou `Ctrl + Alt + Shift + Num 3` | Workspace: Salvar no Slot 3 | Grava a disposição atual diretamente no slot numérico 3 (Ctrl + Alt + Shift + 3) |
| `Ctrl + Alt + Shift + 4` ou `Ctrl + Alt + Shift + Num 4` | Workspace: Salvar no Slot 4 | Grava a disposição atual diretamente no slot numérico 4 (Ctrl + Alt + Shift + 4) |
| `Ctrl + Alt + Shift + 5` ou `Ctrl + Alt + Shift + Num 5` | Workspace: Salvar no Slot 5 | Grava a disposição atual diretamente no slot numérico 5 (Ctrl + Alt + Shift + 5) |
| `Ctrl + Alt + Shift + 6` ou `Ctrl + Alt + Shift + Num 6` | Workspace: Salvar no Slot 6 | Grava a disposição atual diretamente no slot numérico 6 (Ctrl + Alt + Shift + 6) |
| `Ctrl + Alt + Shift + 7` ou `Ctrl + Alt + Shift + Num 7` | Workspace: Salvar no Slot 7 | Grava a disposição atual diretamente no slot numérico 7 (Ctrl + Alt + Shift + 7) |
| `Ctrl + Alt + Shift + 8` ou `Ctrl + Alt + Shift + Num 8` | Workspace: Salvar no Slot 8 | Grava a disposição atual diretamente no slot numérico 8 (Ctrl + Alt + Shift + 8) |
| `Ctrl + Alt + Shift + 9` ou `Ctrl + Alt + Shift + Num 9` | Workspace: Salvar no Slot 9 | Grava a disposição atual diretamente no slot numérico 9 (Ctrl + Alt + Shift + 9) |

### Perfil Adobe Premiere Pro

> Alguns atalhos aparecem em mais de uma ação neste perfil. Isso é intencional: a ação executada depende do contexto (painel em foco, ferramenta ativa, elemento sob o mouse, sugestão ou clipe fantasma ativo). A coluna de observação indica com quais ações o atalho é compartilhado.

#### 1. Reprodução & Navegação

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Espaço` | Play / Pause | Inicia ou pausa a reprodução no player ativo (Source ou Program) |
| `J` | Shuttle Reverso (J) | Reproduz para trás. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x) |
| `K` | Shuttle Play / Pause (K) | Alterna entre reproduzir e pausar a reprodução (segure K com J ou L para avançar/recuar quadro a quadro) |
| `L` | Shuttle Avanço (L) | Reproduz para frente. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x) |
| `Shift + →` | Shuttle Acelerado / Avanço Rápido (Shift + →) | Reproduz acelerado para frente. Toques repetidos aumentam a velocidade (igual JKL); segurar reproduz acelerado enquanto pressionado |
| `Shift + ←` | Shuttle Acelerado / Recuo Rápido (Shift + ←) | Reproduz acelerado para trás. Toques repetidos aumentam a velocidade reversa; segurar reproduz acelerado enquanto pressionado |
| `Ctrl + →` | Câmera Lenta Avanço (Ctrl + →) | Reproduz em câmera lenta para frente (0.25x). Segurar reproduz enquanto pressionado |
| `Ctrl + ←` | Câmera Lenta Recuo (Ctrl + ←) | Reproduz em câmera lenta reversa (-0.25x). Segurar reproduz enquanto pressionado |
| `K + J` ou `←` | Jog Recuar 1 Frame (K + J) | Segure K e pressione J para recuar exatamente 1 frame<br>**Atalho compartilhado, depende do contexto:** Navegar 1 Frame para Trás (←). |
| `←` | Navegar 1 Frame para Trás | Move a agulha 1 frame para trás (quando nenhum clipe estiver selecionado)<br>**Atalho compartilhado, depende do contexto:** Jog Recuar 1 Frame (K + J) (←). |
| `K + L` ou `→` | Jog Avançar 1 Frame (K + L) | Segure K e pressione L para avançar exatamente 1 frame<br>**Atalho compartilhado, depende do contexto:** Navegar 1 Frame para Frente (→). |
| `→` | Navegar 1 Frame para Frente | Move a agulha 1 frame para frente (quando nenhum clipe estiver selecionado)<br>**Atalho compartilhado, depende do contexto:** Jog Avançar 1 Frame (K + L) (→). |
| `I` | Marcar Ponto de Entrada (IN) | Define o ponto inicial de corte no Player ou Linha do Tempo |
| `O` | Marcar Ponto de Saída (OUT) | Define o ponto final de corte no Player ou Linha do Tempo |
| `Ctrl + Shift + I` ou `Alt + I` | Limpar Ponto IN | Remove o ponto de entrada (IN) no Player ou Linha do Tempo |
| `Ctrl + Shift + O` ou `Alt + O` | Limpar Ponto OUT | Remove o ponto de saída (OUT) no Player ou Linha do Tempo |
| `Ctrl + Shift + X` ou `Alt + X` | Limpar Pontos IN e OUT | Remove ambos os pontos de entrada e saída (IN e OUT) |
| `/` ou `X` | Marcar Clipe (IN / OUT) | Define pontos IN e OUT nos limites do clipe selecionado ou sob a agulha |
| `Shift + I` | Ir para o Ponto IN | Move a agulha de reprodução diretamente para o ponto IN |
| `Shift + O` | Ir para o Ponto OUT | Move a agulha de reprodução diretamente para o ponto OUT |
| `Ctrl + Shift + Espaço` ou `Shift + Espaço` ou `Alt + K` | Tocar de IN até OUT | Reproduz o trecho delimitado entre os pontos IN e OUT e pausa |
| `Ctrl + L` | Alternar Reprodução em Loop | Liga ou desliga a reprodução contínua em loop entre os pontos IN e OUT<br>**Atalho compartilhado, depende do contexto:** Desvincular Par Áudio/Vídeo (Ctrl + L). |
| `E` | Inserir na Timeline (Append) | Insere o trecho marcado (IN ➔ OUT) na timeline |
| `↑` | Pular para Ponto Anterior / Início | Program: move a agulha para o corte anterior; Source: vai para IN ou Início |
| `↓` | Pular para Próximo Ponto / Fim | Program: move a agulha para o corte seguinte; Source: vai para OUT ou Fim |
| `Ctrl + G` | Ir para Timecode / Navegação Numérica | Ativa a entrada de timecode para salto absoluto ou navegação relativa (+/- frames) |

#### 2. Ferramentas & Modos

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `V` | Ferramenta de Seleção | Ativa a ferramenta de seleção padrão da timeline (Seta) |
| `Shift + V` | Seleção por Caixa / Retângulo (Marquee) | Ativa a ferramenta de seleção por retângulo (arraste para selecionar clipes e marcadores) |
| `C` | Ferramenta Lâmina / Gilete (Blade) | Ativa a ferramenta de corte de precisão por cursor na trilha |
| `Shift + C` ou `Ctrl + Shift + K` | Lâmina Global na Agulha | Fatia todas as pistas destravadas na coordenada da agulha de reprodução<br>**Atalho compartilhado, depende do contexto:** Alternar Momento Crucial (Player / Galeria) (Ctrl + Shift + K). |
| `Y` | Deslizar Conteúdo Interno (Slip Tool) | Desliza os pontos IN e OUT da mídia bruta mantendo a posição e duração na timeline<br>**Atalho compartilhado, depende do contexto:** Aceitar Sugestão de IA (Y). |
| `U` | Deslizar Posição na Timeline (Slide Tool) | Move o clipe na timeline mantendo seu conteúdo intacto e compensando nos vizinhos adjacentes |
| `N` | Corte Contínuo Adjacente (Rolling Edit) | Ajusta o ponto de corte entre dois clipes contíguos sem alterar a duração total da sequência<br>**Atalho compartilhado, depende do contexto:** Rejeitar Sugestão de IA (N). |
| `R` | Esticar / Comprimir Taxa de Velocidade (Rate Stretch) | Altera a velocidade do clipe arrastando suas bordas para esticar ou comprimir a taxa temporal<br>**Atalho compartilhado, depende do contexto:** Girar Mídia sob Cursor (+90°) (R). |
| `R` | Girar Mídia sob Cursor (+90°) | Rotaciona a mídia sob o cursor (hover) na biblioteca ou no monitor de origem<br>**Atalho compartilhado, depende do contexto:** Esticar / Comprimir Taxa de Velocidade (Rate Stretch) (R). |
| `A` | Selecionar Faixa para Frente | Ativa a ferramenta de seleção de todos os clipes à direita<br>**Atalho compartilhado, depende do contexto:** Alternar Tomadas / Alternativas de IA (A). |
| `Shift + A` | Selecionar Faixa para Trás | Ativa a ferramenta de seleção de todos os clipes à esquerda |
| `S` | Alternar Snapping Magnético | Liga ou desliga o alinhamento magnético inteligente de bordas e agulha |
| `H` | Ferramenta Mão / Pan | Ativa a ferramenta de navegação e arrasto contínuo da timeline (Pan) |
| `Z` | Ferramenta Zoom / Lupa | Ativa a ferramenta de aproximação e afastamento por clique |
| `Esc` | Desmarcar Seleção / Fechar Caixas | Limpa a seleção de clipes ou fecha pop-ups contextuais e modais |

#### 3. Edição, Cortes & Trims

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `,` | Inserir na Agulha (Ripple Insert) | Insere o trecho marcado no monitor Source na coordenada da agulha empurrando os clipes subsequentes |
| `.` | Sobrescrever na Agulha (Overwrite Edit) | Insere o trecho marcado no monitor Source na coordenada da agulha substituindo o material sob o intervalo |
| `Ctrl + Alt + A` | Alternar Canais na Inserção (AV / V / A) | Alterna os canais transferidos do monitor Source para a Timeline: Áudio+Vídeo (AV), Somente Vídeo (V) ou Somente Áudio (A) |
| `F` | Localizar Quadro Original na Fonte (Match Frame) | Localiza a mídia bruta correspondente ao quadro sob a agulha da timeline e abre no Source Player marcando os pontos IN–OUT originais |
| `Shift + F` | Localizar Quadro na Timeline (Reverse Match Frame) | Localiza onde o quadro atual sob a agulha do Source Player está sendo utilizado na timeline ativa e salta a agulha para a posição correspondente |
| `Ctrl + Shift + R` | Substituir Clipe na Timeline (Replace Edit) | Substitui a mídia do clipe alvo (selecionado, sob a agulha ou sob o cursor com Alt no arraste) preservando duração exata, efeitos (Ken Burns), cor e velocidade |
| `Ctrl + U` | Criar Subclipe na Biblioteca (Make Subclip) | Gera um novo item virtual na biblioteca a partir do intervalo [IN–OUT] delimitado no monitor Source |
| `Ctrl + Shift + F` | Congelar Quadro (Freeze Frame) | Captura o quadro sob a agulha e insere um segmento estático na timeline (Ctrl+Shift+F) |
| `Ctrl + R` | Velocidade / Duração do Clipe (Speed / Duration) | Abre o diálogo de velocidade percentual, duração proporcional e reversão do clipe selecionado (Ctrl+R) |
| `Ctrl + Alt + R` | Preencher Espaço na Trilha (Fit to Gap) | Estende a duração do clipe ajustando a velocidade para preencher automaticamente o espaço vazio adjacente na pista (Ctrl+Alt+R) |
| `Ctrl + Shift + D` | Crossfade de Áudio (Potência Constante) | Aplica transição de crossfade de áudio de potência constante (Equal-Power) na emenda entre clipes contíguos ou no clipe selecionado (Ctrl+Shift+D) |
| `Ctrl + D` | Transição de Vídeo Padrão (Cross Dissolve) | Aplica transição de vídeo (Cross Dissolve, Dip to Black ou Dip to White) na emenda contígua sob a agulha ou entre os clipes selecionados (Ctrl+D) |
| `Enter` | Renderizar Efeitos In para Out (Cache NLE) | Pré-renderiza o intervalo da timeline (In-Out ou trechos pesados) para playback suave em cache (Enter)<br>**Atalho compartilhado, depende do contexto:** Aceitar Sugestão de IA (Enter). |
| `Ctrl + K` | Dividir Clipe no Playhead (Split) | Fatia o clipe sob a agulha de reprodução (ou o clipe selecionado) |
| `Q` | Ripple Trim Início (Até a Agulha) | Corta o início do clipe até a agulha e fecha o espaço na timeline |
| `W` | Ripple Trim Fim (Da Agulha ao Fim) | Corta da agulha até o final do clipe e fecha o espaço na timeline |
| `Backspace` | Lift Delete (Apagar Clipe) | Apaga o clipe selecionado deixando o espaço vazio (gap) intacto |
| `Shift + Del` ou `Alt + Backspace` | Ripple Delete (Apagar e Fechar Espaço) | Apaga o clipe e puxa todos os clipes posteriores para fechar a lacuna<br>**Atalho compartilhado, depende do contexto:** Extract (Ripple Delete) no Intervalo IN–OUT (Shift + Del). |
| `Quote` ou `Shift + Del` | Extract (Ripple Delete) no Intervalo IN–OUT | Apaga o conteúdo dentro do intervalo IN–OUT e puxa os clipes posteriores para fechar o espaço<br>**Atalho compartilhado, depende do contexto:** Ripple Delete (Apagar e Fechar Espaço) (Shift + Del). |
| `Semicolon` ou `Alt + Del` | Lift no Intervalo IN–OUT | Apaga o conteúdo dentro do intervalo IN–OUT nas pistas ativas deixando o espaço vazio (gap)<br>**Atalho compartilhado, depende do contexto:** Apagar Faixa Única (Desvincular Par) (Alt + Del). |
| `Alt + Del` | Apagar Faixa Única (Desvincular Par) | Apaga apenas o vídeo ou o áudio selecionado, preservando o outro fluxo<br>**Atalho compartilhado, depende do contexto:** Lift no Intervalo IN–OUT (Alt + Del). |
| `Ctrl + L` | Desvincular Par Áudio/Vídeo | Quebra a vinculação estrita entre o vídeo e seu par de áudio correspondente<br>**Atalho compartilhado, depende do contexto:** Alternar Reprodução em Loop (Ctrl + L). |
| `Alt + ←` | Nudge: Deslocar 1 Frame para Trás | Move o clipe selecionado 1 frame para a esquerda na timeline |
| `Alt + →` | Nudge: Deslocar 1 Frame para Frente | Move o clipe selecionado 1 frame para a direita na timeline |
| `Ctrl + Alt + ←` | Trim Ponto IN: Recuar 1 Frame | Expande ou contrai a ponta inicial do clipe selecionado em 1 frame |
| `Ctrl + Alt + →` | Trim Ponto IN: Avançar 1 Frame | Avança a ponta inicial do clipe selecionado em 1 frame |
| `Ctrl + Shift + ←` | Trim Ponto OUT: Recuar 1 Frame | Recua a ponta final do clipe selecionado em 1 frame |
| `Ctrl + Shift + →` | Trim Ponto OUT: Avançar 1 Frame | Avança a ponta final do clipe selecionado em 1 frame |
| `D` | Selecionar Clipe sob a Agulha | Seleciona o clipe na trilha ativa posicionado sob a agulha de reprodução (D) |
| `Shift + D` | Multi-Seleção na Agulha (Adicionar à Seleção) | Seleciona todos os clipes sob a agulha em todas as pistas e adiciona à seleção existente (Shift+D) |
| `Shift + E` | Ativar / Desativar Clipe (Mute / Bypass) | Alterna se o clipe selecionado (ou sob a agulha) está ativo ou desativado |

#### 4. Marcadores

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `M` | Adicionar / Editar Marcador | Cria um novo marcador ou abre o popover de edição rápida no playhead |
| `Shift + M` | Pular para o Próximo Marcador | Avança a agulha de reprodução até o marcador seguinte na timeline |
| `Ctrl + Shift + M` ou `Alt + M` | Pular para o Marcador Anterior | Recua a agulha de reprodução até o marcador anterior na timeline |
| `Ctrl + Shift + K` | Alternar Momento Crucial (Player / Galeria) | Marca ou desmarca o quadro atual como Momento Crucial para reprodução rápida em hover<br>**Atalho compartilhado, depende do contexto:** Lâmina Global na Agulha (Ctrl + Shift + K). |

#### 5. Assistência de IA & Tomadas

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Alt + B` | Alternar Detecção Facial no Source | Exibe ou oculta a camada visual de caixas de detecção facial e grounding no Monitor de Origem (Source) |
| `Shift + T` ou `A` | Alternar Tomadas / Alternativas de IA | Abre o seletor de tomadas alternativas em clipes gerados por IA / Inspetor<br>**Atalho compartilhado, depende do contexto:** Selecionar Faixa para Frente (A). |
| `Enter` ou `Y` | Aceitar Sugestão de IA | Aprova a sugestão da faixa fantasma de IA, tornando-a clipe real na trilha<br>**Atalho compartilhado, depende do contexto:** Renderizar Efeitos In para Out (Cache NLE) (Enter); Deslizar Conteúdo Interno (Slip Tool) (Y). |
| `Del` ou `N` | Rejeitar Sugestão de IA | Descarta e remove a sugestão fantasma da timeline<br>**Atalho compartilhado, depende do contexto:** Corte Contínuo Adjacente (Rolling Edit) (N). |

#### 6. Canvas, Zoom & Histórico

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `\` | Ajustar Sequência na Tela (Zoom to Fit) | Enquadra perfeitamente todos os clipes na timeline ou restaura o zoom anterior (Toggle) |
| `+ / =` ou `Num +` | Aumentar Zoom na Linha do Tempo | Aproxima o zoom horizontal da régua e clipes da timeline<br>**Atalho compartilhado, depende do contexto:** Timeline: Aumentar Altura das Pistas (Num +). |
| `-` ou `Num -` | Diminuir Zoom na Linha do Tempo | Afasta o zoom horizontal da régua e clipes da timeline<br>**Atalho compartilhado, depende do contexto:** Timeline: Diminuir Altura das Pistas (Num -). |
| `Ctrl + 1` | Restaurar Zoom Padrão (1:1 / 0.5 px/f) | Restaura a escala da régua e dos clipes para o zoom padrão de 0.5 pixels por frame |
| `Ctrl + Alt + P` | Alternar 'Seleção Acompanha a Agulha' | Ativa ou desativa a seleção automática do clipe sob a agulha ao se mover |
| `Ctrl + Alt + F` | Alternar 'Timeline Segue a Agulha' (Auto-Scroll) | Ativa ou desativa a rolagem automática da timeline para acompanhar o cursor de reprodução |
| `Ctrl + Shift + L` ou `Shift + L` | Travar / Destravar Pista Ativa (Track Lock) | Ativa ou desativa o cadeado físico de proteção total na pista selecionada |
| `Ctrl + Alt + Shift + L` | Travar / Destravar Todas as Pistas | Alterna o cadeado físico em todas as pistas de vídeo, áudio e texto da timeline |
| `Ctrl + Shift + G` | Alternar Margens de Segurança & Guias no Player (Safe Margins) | Exibe ou oculta o overlay vetorial de Action Safe (90%), Title Safe (80%), Cruz Central e Máscaras de Proporção no Monitor de Programa |
| `Ctrl + Alt + G` | Alternar Máscara de Proporção no Player (16:9 / 9:16 / 1:1 / 2.39:1) | Alterna ciclicamente entre as máscaras de proporção de aspecto (16:9, 9:16, 1:1, 2.39:1, 4:5, 4:3, Sem Máscara) no Monitor de Programa |
| `Ctrl + Z` | Desfazer Ação (Undo) | Desfaz a última alteração realizada na timeline |
| `Ctrl + Shift + Z` ou `Ctrl + Y` | Refazer Ação (Redo) | Refaz a edição desfeita anteriormente |
| `Ctrl + Shift + S` | Salvar Preset de Workspace | Abre o diálogo para salvar o layout visual atual da interface |

#### 7. Layout & Workspace (Numpad)

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Alt + Z` | Desfazer Mudança de Layout | Desfaz a última mudança na disposição dos painéis (histórico separado do da timeline) |
| `Ctrl + Alt + Shift + Z` | Refazer Mudança de Layout | Refaz a mudança de layout desfeita anteriormente |
| `Num 1` | Timeline: Expansão Direcional Esquerda | Alterna a expansão da timeline sob a sidebar esquerda (bottom-left ↔ center) |
| `Alt + Num 1` | Timeline: Toggle Cabeçalho de Pistas | Oculta ou exibe a área de faixas e timecode da timeline (Track Headers) |
| `Num 2` | Timeline: Alternar Centro ↔ Faixa Total | Alterna a timeline entre entre menus (center) e largura total na base (bottom-full) |
| `Alt + Num 2` | Timeline: Recolher / Restaurar Verticalmente | Recolhe ou expande o painel da timeline para a linha restauradora na base |
| `Ctrl + Num 2` | Timeline: Destacar / Reanexar Janela | Abre a timeline em janela flutuante para o segundo monitor ou a reanexa |
| `Num 3` | Timeline: Expansão Direcional Direita | Alterna a expansão da timeline sob a sidebar direita (bottom-right ↔ center) |
| `Alt + Num 3` | Timeline: Toggle Barra de Ferramentas | Recolhe ou expande a barra vertical de ferramentas de corte (V, C, Trims) |
| `Num 4` | Biblioteca: Ocultar / Exibir | Recolhe ou expande a sidebar esquerda (Biblioteca de mídias, temas, rostos) |
| `Alt + Num 4` | Biblioteca: Layout Estúdio (Maximizar) | Maximiza a biblioteca no layout estúdio com timeline e players empilhados |
| `Ctrl + Num 4` | Biblioteca: Destacar / Reanexar Janela | Abre a biblioteca em janela flutuante externa ou a reanexa |
| `Num 5` | Inspetor: Ocultar / Exibir | Recolhe ou expande o painel de Ajustes & Efeitos (Inspetor) |
| `Alt + Num 5` | Inspetor: Maximizar / Restaurar | Maximiza o painel de Ajustes & Efeitos no espaço disponível |
| `Ctrl + Num 5` | Inspetor: Destacar / Reanexar Janela | Abre o Inspetor em janela flutuante externa ou o reanexa |
| `Num 6` | Painel Direito: Ocultar / Exibir | Recolhe ou expande a sidebar direita (Transcrição, Visão IA, Tarefas, Logs) |
| `Alt + Num 6` | Painel Direito: Maximizar / Restaurar | Maximiza a sidebar direita no espaço disponível |
| `Ctrl + Num 6` | Painel Direito: Destacar / Reanexar Janela | Abre a sidebar direita em janela flutuante externa ou a reanexa |
| `Num 7` | Source Player: Ocultar / Exibir | Oculta ou exibe o monitor de origem (Source Player) |
| `Alt + Num 7` | Source Player: Maximizar / Restaurar | Maximiza o monitor de origem no palco central |
| `Ctrl + Num 7` | Source Player: Destacar / Reanexar Janela | Abre o monitor de origem em janela flutuante externa ou o reanexa |
| `Num 8` | Header Geral: Ocultar / Exibir | Recolhe ou expande o cabeçalho superior da aplicação para ganhar espaço vertical |
| `Num 9` | Program Player: Ocultar / Exibir | Oculta ou exibe o monitor de programa (Program Player) |
| `Alt + Num 9` | Program Player: Maximizar / Restaurar | Maximiza o monitor de programa no palco central |
| `Ctrl + Num 9` | Program Player: Destacar / Reanexar Janela | Abre o monitor de programa em janela flutuante externa ou o reanexa |
| `Num 0` | Modo Foco / Cinema / Zen | Macro global: recolhe ou restaura Header e todas as Sidebars simultaneamente |
| `Num .` | Timeline: Toggle Cabeçalho Superior | Recolhe ou restaura a barra superior de nome, zoom e sequência da timeline |
| `Num +` | Timeline: Aumentar Altura das Pistas | Aumenta a altura das faixas de áudio e vídeo na timeline (+10px)<br>**Atalho compartilhado, depende do contexto:** Aumentar Zoom na Linha do Tempo (Num +). |
| `Num -` | Timeline: Diminuir Altura das Pistas | Diminui a altura das faixas de áudio e vídeo na timeline (-10px)<br>**Atalho compartilhado, depende do contexto:** Diminuir Zoom na Linha do Tempo (Num -). |
| `Num /` | Monitores: Alternar Lado a Lado / Empilhados | Alterna a disposição dos monitores entre horizontal e vertical |
| `Num *` | Monitores: Swap / Alternar Foco | Alterna o foco ativo entre o Monitor Source e o Monitor Program |
| `Num Enter` | Maximizar / Restaurar Painel sob Foco | Maximiza ou restaura o painel ativo ou sob o cursor |
| `Ctrl + Alt + 1` ou `Ctrl + Alt + Num 1` | Workspace: Carregar Slot 1 | Carrega instantaneamente o layout salvo no slot numérico 1 (Ctrl + Alt + 1) |
| `Ctrl + Alt + 2` ou `Ctrl + Alt + Num 2` | Workspace: Carregar Slot 2 | Carrega instantaneamente o layout salvo no slot numérico 2 (Ctrl + Alt + 2) |
| `Ctrl + Alt + 3` ou `Ctrl + Alt + Num 3` | Workspace: Carregar Slot 3 | Carrega instantaneamente o layout salvo no slot numérico 3 (Ctrl + Alt + 3) |
| `Ctrl + Alt + 4` ou `Ctrl + Alt + Num 4` | Workspace: Carregar Slot 4 | Carrega instantaneamente o layout salvo no slot numérico 4 (Ctrl + Alt + 4) |
| `Ctrl + Alt + 5` ou `Ctrl + Alt + Num 5` | Workspace: Carregar Slot 5 | Carrega instantaneamente o layout salvo no slot numérico 5 (Ctrl + Alt + 5) |
| `Ctrl + Alt + 6` ou `Ctrl + Alt + Num 6` | Workspace: Carregar Slot 6 | Carrega instantaneamente o layout salvo no slot numérico 6 (Ctrl + Alt + 6) |
| `Ctrl + Alt + 7` ou `Ctrl + Alt + Num 7` | Workspace: Carregar Slot 7 | Carrega instantaneamente o layout salvo no slot numérico 7 (Ctrl + Alt + 7) |
| `Ctrl + Alt + 8` ou `Ctrl + Alt + Num 8` | Workspace: Carregar Slot 8 | Carrega instantaneamente o layout salvo no slot numérico 8 (Ctrl + Alt + 8) |
| `Ctrl + Alt + 9` ou `Ctrl + Alt + Num 9` | Workspace: Carregar Slot 9 | Carrega instantaneamente o layout salvo no slot numérico 9 (Ctrl + Alt + 9) |
| `Ctrl + Alt + Shift + 1` ou `Ctrl + Alt + Shift + Num 1` | Workspace: Salvar no Slot 1 | Grava a disposição atual diretamente no slot numérico 1 (Ctrl + Alt + Shift + 1) |
| `Ctrl + Alt + Shift + 2` ou `Ctrl + Alt + Shift + Num 2` | Workspace: Salvar no Slot 2 | Grava a disposição atual diretamente no slot numérico 2 (Ctrl + Alt + Shift + 2) |
| `Ctrl + Alt + Shift + 3` ou `Ctrl + Alt + Shift + Num 3` | Workspace: Salvar no Slot 3 | Grava a disposição atual diretamente no slot numérico 3 (Ctrl + Alt + Shift + 3) |
| `Ctrl + Alt + Shift + 4` ou `Ctrl + Alt + Shift + Num 4` | Workspace: Salvar no Slot 4 | Grava a disposição atual diretamente no slot numérico 4 (Ctrl + Alt + Shift + 4) |
| `Ctrl + Alt + Shift + 5` ou `Ctrl + Alt + Shift + Num 5` | Workspace: Salvar no Slot 5 | Grava a disposição atual diretamente no slot numérico 5 (Ctrl + Alt + Shift + 5) |
| `Ctrl + Alt + Shift + 6` ou `Ctrl + Alt + Shift + Num 6` | Workspace: Salvar no Slot 6 | Grava a disposição atual diretamente no slot numérico 6 (Ctrl + Alt + Shift + 6) |
| `Ctrl + Alt + Shift + 7` ou `Ctrl + Alt + Shift + Num 7` | Workspace: Salvar no Slot 7 | Grava a disposição atual diretamente no slot numérico 7 (Ctrl + Alt + Shift + 7) |
| `Ctrl + Alt + Shift + 8` ou `Ctrl + Alt + Shift + Num 8` | Workspace: Salvar no Slot 8 | Grava a disposição atual diretamente no slot numérico 8 (Ctrl + Alt + Shift + 8) |
| `Ctrl + Alt + Shift + 9` ou `Ctrl + Alt + Shift + Num 9` | Workspace: Salvar no Slot 9 | Grava a disposição atual diretamente no slot numérico 9 (Ctrl + Alt + Shift + 9) |

### Perfil DaVinci Resolve

> Alguns atalhos aparecem em mais de uma ação neste perfil. Isso é intencional: a ação executada depende do contexto (painel em foco, ferramenta ativa, elemento sob o mouse, sugestão ou clipe fantasma ativo). A coluna de observação indica com quais ações o atalho é compartilhado.

#### 1. Reprodução & Navegação

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Espaço` | Play / Pause | Inicia ou pausa a reprodução no player ativo (Source ou Program) |
| `J` | Shuttle Reverso (J) | Reproduz para trás. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x) |
| `K` | Shuttle Play / Pause (K) | Alterna entre reproduzir e pausar a reprodução (segure K com J ou L para avançar/recuar quadro a quadro) |
| `L` | Shuttle Avanço (L) | Reproduz para frente. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x) |
| `Shift + →` | Shuttle Acelerado / Avanço Rápido (Shift + →) | Reproduz acelerado para frente. Toques repetidos aumentam a velocidade (igual JKL); segurar reproduz acelerado enquanto pressionado |
| `Shift + ←` | Shuttle Acelerado / Recuo Rápido (Shift + ←) | Reproduz acelerado para trás. Toques repetidos aumentam a velocidade reversa; segurar reproduz acelerado enquanto pressionado |
| `Ctrl + →` | Câmera Lenta Avanço (Ctrl + →) | Reproduz em câmera lenta para frente (0.25x). Segurar reproduz enquanto pressionado |
| `Ctrl + ←` | Câmera Lenta Recuo (Ctrl + ←) | Reproduz em câmera lenta reversa (-0.25x). Segurar reproduz enquanto pressionado |
| `K + J` ou `←` | Jog Recuar 1 Frame (K + J) | Segure K e pressione J para recuar exatamente 1 frame<br>**Atalho compartilhado, depende do contexto:** Navegar 1 Frame para Trás (←). |
| `←` | Navegar 1 Frame para Trás | Move a agulha 1 frame para trás (quando nenhum clipe estiver selecionado)<br>**Atalho compartilhado, depende do contexto:** Jog Recuar 1 Frame (K + J) (←). |
| `K + L` ou `→` | Jog Avançar 1 Frame (K + L) | Segure K e pressione L para avançar exatamente 1 frame<br>**Atalho compartilhado, depende do contexto:** Navegar 1 Frame para Frente (→). |
| `→` | Navegar 1 Frame para Frente | Move a agulha 1 frame para frente (quando nenhum clipe estiver selecionado)<br>**Atalho compartilhado, depende do contexto:** Jog Avançar 1 Frame (K + L) (→). |
| `I` | Marcar Ponto de Entrada (IN) | Define o ponto inicial de corte no Player ou Linha do Tempo |
| `O` | Marcar Ponto de Saída (OUT) | Define o ponto final de corte no Player ou Linha do Tempo |
| `Alt + I` | Limpar Ponto IN | Remove o ponto de entrada (IN) no Player ou Linha do Tempo |
| `Alt + O` | Limpar Ponto OUT | Remove o ponto de saída (OUT) no Player ou Linha do Tempo |
| `Alt + X` | Limpar Pontos IN e OUT | Remove ambos os pontos de entrada e saída (IN e OUT) |
| `X` | Marcar Clipe (IN / OUT) | Define pontos IN e OUT nos limites do clipe selecionado ou sob a agulha |
| `Shift + I` | Ir para o Ponto IN | Move a agulha de reprodução diretamente para o ponto IN |
| `Shift + O` | Ir para o Ponto OUT | Move a agulha de reprodução diretamente para o ponto OUT |
| `Alt + /` ou `Shift + Espaço` | Tocar de IN até OUT | Reproduz o trecho delimitado entre os pontos IN e OUT e pausa |
| `Ctrl + /` ou `Ctrl + L` | Alternar Reprodução em Loop | Liga ou desliga a reprodução contínua em loop entre os pontos IN e OUT |
| `Shift + F12` ou `E` | Inserir na Timeline (Append) | Insere o trecho marcado (IN ➔ OUT) na timeline |
| `↑` | Pular para Ponto Anterior / Início | Program: move a agulha para o corte anterior; Source: vai para IN ou Início |
| `↓` | Pular para Próximo Ponto / Fim | Program: move a agulha para o corte seguinte; Source: vai para OUT ou Fim |
| `Ctrl + G` | Ir para Timecode / Navegação Numérica | Ativa a entrada de timecode para salto absoluto ou navegação relativa (+/- frames) |

#### 2. Ferramentas & Modos

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `A` | Ferramenta de Seleção | Ativa a ferramenta de seleção padrão da timeline (Seta)<br>**Atalho compartilhado, depende do contexto:** Alternar Tomadas / Alternativas de IA (A). |
| `Shift + A` | Seleção por Caixa / Retângulo (Marquee) | Ativa a ferramenta de seleção por retângulo (arraste para selecionar clipes e marcadores) |
| `B` | Ferramenta Lâmina / Gilete (Blade) | Ativa a ferramenta de corte de precisão por cursor na trilha |
| `Shift + B` ou `Ctrl + Shift + \` | Lâmina Global na Agulha | Fatia todas as pistas destravadas na coordenada da agulha de reprodução |
| `Shift + Y` ou `Y` | Deslizar Conteúdo Interno (Slip Tool) | Desliza os pontos IN e OUT da mídia bruta mantendo a posição e duração na timeline<br>**Atalho compartilhado, depende do contexto:** Selecionar Faixa para Frente (Y); Aceitar Sugestão de IA (Y). |
| `Y` | Selecionar Faixa para Frente | Ativa a ferramenta de seleção de todos os clipes à direita<br>**Atalho compartilhado, depende do contexto:** Deslizar Conteúdo Interno (Slip Tool) (Y); Aceitar Sugestão de IA (Y). |
| `U` | Deslizar Posição na Timeline (Slide Tool) | Move o clipe na timeline mantendo seu conteúdo intacto e compensando nos vizinhos adjacentes |
| `N` ou `T` | Corte Contínuo Adjacente (Rolling Edit) | Ajusta o ponto de corte entre dois clipes contíguos sem alterar a duração total da sequência<br>**Atalho compartilhado, depende do contexto:** Rejeitar Sugestão de IA (N); Alternar Tomadas / Alternativas de IA (T). |
| `R` ou `Shift + R` | Esticar / Comprimir Taxa de Velocidade (Rate Stretch) | Altera a velocidade do clipe arrastando suas bordas para esticar ou comprimir a taxa temporal<br>**Atalho compartilhado, depende do contexto:** Girar Mídia sob Cursor (+90°) (R). |
| `R` | Girar Mídia sob Cursor (+90°) | Rotaciona a mídia sob o cursor (hover) na biblioteca ou no monitor de origem<br>**Atalho compartilhado, depende do contexto:** Esticar / Comprimir Taxa de Velocidade (Rate Stretch) (R). |
| `Ctrl + Y` | Selecionar Faixa para Trás | Ativa a ferramenta de seleção de todos os clipes à esquerda<br>**Atalho compartilhado, depende do contexto:** Refazer Ação (Redo) (Ctrl + Y). |
| `Shift + N` ou `S` | Alternar Snapping Magnético | Liga ou desliga o alinhamento magnético inteligente de bordas e agulha |
| `H` | Ferramenta Mão / Pan | Ativa a ferramenta de navegação e arrasto contínuo da timeline (Pan) |
| `Z` | Ferramenta Zoom / Lupa | Ativa a ferramenta de aproximação e afastamento por clique |
| `Esc` | Desmarcar Seleção / Fechar Caixas | Limpa a seleção de clipes ou fecha pop-ups contextuais e modais |

#### 3. Edição, Cortes & Trims

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `F9` ou `,` | Inserir na Agulha (Ripple Insert) | Insere o trecho marcado no monitor Source na coordenada da agulha empurrando os clipes subsequentes |
| `F10` ou `.` | Sobrescrever na Agulha (Overwrite Edit) | Insere o trecho marcado no monitor Source na coordenada da agulha substituindo o material sob o intervalo |
| `Ctrl + Alt + A` | Alternar Canais na Inserção (AV / V / A) | Alterna os canais transferidos do monitor Source para a Timeline: Áudio+Vídeo (AV), Somente Vídeo (V) ou Somente Áudio (A) |
| `F` | Localizar Quadro Original na Fonte (Match Frame) | Localiza a mídia bruta correspondente ao quadro sob a agulha da timeline e abre no Source Player marcando os pontos IN–OUT originais |
| `Shift + F` | Localizar Quadro na Timeline (Reverse Match Frame) | Localiza onde o quadro atual sob a agulha do Source Player está sendo utilizado na timeline ativa e salta a agulha para a posição correspondente |
| `Ctrl + Shift + R` | Substituir Clipe na Timeline (Replace Edit) | Substitui a mídia do clipe alvo (selecionado, sob a agulha ou sob o cursor com Alt no arraste) preservando duração exata, efeitos (Ken Burns), cor e velocidade |
| `Ctrl + U` | Criar Subclipe na Biblioteca (Make Subclip) | Gera um novo item virtual na biblioteca a partir do intervalo [IN–OUT] delimitado no monitor Source |
| `Ctrl + Shift + F` | Congelar Quadro (Freeze Frame) | Captura o quadro sob a agulha e insere um segmento estático na timeline (Ctrl+Shift+F) |
| `Ctrl + R` | Velocidade / Duração do Clipe (Speed / Duration) | Abre o diálogo de velocidade percentual, duração proporcional e reversão do clipe selecionado (Ctrl+R) |
| `Ctrl + Alt + R` ou `Cmd + Alt + R` | Preencher Espaço na Trilha (Fit to Gap) | Estende a duração do clipe ajustando a velocidade para preencher automaticamente o espaço vazio adjacente na pista (Ctrl+Alt+R) |
| `Alt + T` ou `Ctrl + Shift + D` | Crossfade de Áudio (Potência Constante) | Aplica transição de crossfade de áudio de potência constante (Equal-Power) na emenda entre clipes contíguos ou no clipe selecionado (Ctrl+Shift+D) |
| `Ctrl + T` ou `Ctrl + D` | Transição de Vídeo Padrão (Cross Dissolve) | Aplica transição de vídeo (Cross Dissolve, Dip to Black ou Dip to White) na emenda contígua sob a agulha ou entre os clipes selecionados (Ctrl+D) |
| `Enter` | Renderizar Efeitos In para Out (Cache NLE) | Pré-renderiza o intervalo da timeline (In-Out ou trechos pesados) para playback suave em cache (Enter)<br>**Atalho compartilhado, depende do contexto:** Aceitar Sugestão de IA (Enter). |
| `Ctrl + \` | Dividir Clipe no Playhead (Split) | Fatia o clipe sob a agulha de reprodução (ou o clipe selecionado) |
| `Shift + [` ou `Q` | Ripple Trim Início (Até a Agulha) | Corta o início do clipe até a agulha e fecha o espaço na timeline |
| `Shift + ]` ou `W` | Ripple Trim Fim (Da Agulha ao Fim) | Corta da agulha até o final do clipe e fecha o espaço na timeline |
| `Backspace` | Lift Delete (Apagar Clipe) | Apaga o clipe selecionado deixando o espaço vazio (gap) intacto<br>**Atalho compartilhado, depende do contexto:** Lift no Intervalo IN–OUT (Backspace). |
| `Backspace` ou `Semicolon` | Lift no Intervalo IN–OUT | Apaga o conteúdo dentro do intervalo IN–OUT nas pistas ativas deixando o espaço vazio (gap)<br>**Atalho compartilhado, depende do contexto:** Lift Delete (Apagar Clipe) (Backspace). |
| `Shift + Backspace` ou `Del` | Ripple Delete (Apagar e Fechar Espaço) | Apaga o clipe e puxa todos os clipes posteriores para fechar a lacuna<br>**Atalho compartilhado, depende do contexto:** Extract (Ripple Delete) no Intervalo IN–OUT (Shift + Backspace); Rejeitar Sugestão de IA (Del). |
| `Shift + Backspace` ou `Quote` | Extract (Ripple Delete) no Intervalo IN–OUT | Apaga o conteúdo dentro do intervalo IN–OUT e puxa os clipes posteriores para fechar o espaço<br>**Atalho compartilhado, depende do contexto:** Ripple Delete (Apagar e Fechar Espaço) (Shift + Backspace). |
| `Alt + Del` ou `Alt + Backspace` | Apagar Faixa Única (Desvincular Par) | Apaga apenas o vídeo ou o áudio selecionado, preservando o outro fluxo |
| `Ctrl + Alt + L` | Desvincular Par Áudio/Vídeo | Quebra a vinculação estrita entre o vídeo e seu par de áudio correspondente |
| `Alt + ←` | Nudge: Deslocar 1 Frame para Trás | Move o clipe selecionado 1 frame para a esquerda na timeline |
| `Alt + →` | Nudge: Deslocar 1 Frame para Frente | Move o clipe selecionado 1 frame para a direita na timeline |
| `Shift + ,` | Trim Ponto IN: Recuar 1 Frame | Expande ou contrai a ponta inicial do clipe selecionado em 1 frame |
| `Shift + .` | Trim Ponto IN: Avançar 1 Frame | Avança a ponta inicial do clipe selecionado em 1 frame |
| `Ctrl + ,` | Trim Ponto OUT: Recuar 1 Frame | Recua a ponta final do clipe selecionado em 1 frame |
| `Ctrl + .` | Trim Ponto OUT: Avançar 1 Frame | Avança a ponta final do clipe selecionado em 1 frame |
| `D` | Selecionar Clipe sob a Agulha | Seleciona o clipe na trilha ativa posicionado sob a agulha de reprodução (D)<br>**Atalho compartilhado, depende do contexto:** Ativar / Desativar Clipe (Mute / Bypass) (D). |
| `D` | Ativar / Desativar Clipe (Mute / Bypass) | Alterna se o clipe selecionado (ou sob a agulha) está ativo ou desativado<br>**Atalho compartilhado, depende do contexto:** Selecionar Clipe sob a Agulha (D). |
| `Shift + D` | Multi-Seleção na Agulha (Adicionar à Seleção) | Seleciona todos os clipes sob a agulha em todas as pistas e adiciona à seleção existente (Shift+D) |

#### 4. Marcadores

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `M` | Adicionar / Editar Marcador | Cria um novo marcador ou abre o popover de edição rápida no playhead |
| `Shift + M` | Pular para o Próximo Marcador | Avança a agulha de reprodução até o marcador seguinte na timeline |
| `Alt + M` | Pular para o Marcador Anterior | Recua a agulha de reprodução até o marcador anterior na timeline |
| `Ctrl + Shift + K` | Alternar Momento Crucial (Player / Galeria) | Marca ou desmarca o quadro atual como Momento Crucial para reprodução rápida em hover |

#### 5. Assistência de IA & Tomadas

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Alt + B` | Alternar Detecção Facial no Source | Exibe ou oculta a camada visual de caixas de detecção facial e grounding no Monitor de Origem (Source) |
| `T` ou `A` | Alternar Tomadas / Alternativas de IA | Abre o seletor de tomadas alternativas em clipes gerados por IA / Inspetor<br>**Atalho compartilhado, depende do contexto:** Corte Contínuo Adjacente (Rolling Edit) (T); Ferramenta de Seleção (A). |
| `Enter` ou `Y` | Aceitar Sugestão de IA | Aprova a sugestão da faixa fantasma de IA, tornando-a clipe real na trilha<br>**Atalho compartilhado, depende do contexto:** Renderizar Efeitos In para Out (Cache NLE) (Enter); Deslizar Conteúdo Interno (Slip Tool) (Y); Selecionar Faixa para Frente (Y). |
| `Del` ou `N` | Rejeitar Sugestão de IA | Descarta e remove a sugestão fantasma da timeline<br>**Atalho compartilhado, depende do contexto:** Ripple Delete (Apagar e Fechar Espaço) (Del); Corte Contínuo Adjacente (Rolling Edit) (N). |

#### 6. Canvas, Zoom & Histórico

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Shift + Z` | Ajustar Sequência na Tela (Zoom to Fit) | Enquadra perfeitamente todos os clipes na timeline ou restaura o zoom anterior (Toggle) |
| `Ctrl + + / =` ou `Ctrl + Num +` ou `Cmd + + / =` | Aumentar Zoom na Linha do Tempo | Aproxima o zoom horizontal da régua e clipes da timeline |
| `Ctrl + -` ou `Ctrl + Num -` ou `Cmd + -` | Diminuir Zoom na Linha do Tempo | Afasta o zoom horizontal da régua e clipes da timeline |
| `Shift + 1` | Restaurar Zoom Padrão (1:1 / 0.5 px/f) | Restaura a escala da régua e dos clipes para o zoom padrão de 0.5 pixels por frame |
| `Ctrl + Alt + P` | Alternar 'Seleção Acompanha a Agulha' | Ativa ou desativa a seleção automática do clipe sob a agulha ao se mover |
| `Ctrl + Alt + F` | Alternar 'Timeline Segue a Agulha' (Auto-Scroll) | Ativa ou desativa a rolagem automática da timeline para acompanhar o cursor de reprodução |
| `Alt + Shift + L` ou `Shift + L` | Travar / Destravar Pista Ativa (Track Lock) | Ativa ou desativa o cadeado físico de proteção total na pista selecionada |
| `Ctrl + Alt + Shift + L` | Travar / Destravar Todas as Pistas | Alterna o cadeado físico em todas as pistas de vídeo, áudio e texto da timeline |
| `Ctrl + Shift + G` | Alternar Margens de Segurança & Guias no Player (Safe Margins) | Exibe ou oculta o overlay vetorial de Action Safe (90%), Title Safe (80%), Cruz Central e Máscaras de Proporção no Monitor de Programa |
| `Ctrl + Alt + G` | Alternar Máscara de Proporção no Player (16:9 / 9:16 / 1:1 / 2.39:1) | Alterna ciclicamente entre as máscaras de proporção de aspecto (16:9, 9:16, 1:1, 2.39:1, 4:5, 4:3, Sem Máscara) no Monitor de Programa |
| `Ctrl + Z` | Desfazer Ação (Undo) | Desfaz a última alteração realizada na timeline |
| `Ctrl + Shift + Z` ou `Ctrl + Y` | Refazer Ação (Redo) | Refaz a edição desfeita anteriormente<br>**Atalho compartilhado, depende do contexto:** Selecionar Faixa para Trás (Ctrl + Y). |
| `Ctrl + Shift + S` | Salvar Preset de Workspace | Abre o diálogo para salvar o layout visual atual da interface |

#### 7. Layout & Workspace (Numpad)

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Alt + Z` | Desfazer Mudança de Layout | Desfaz a última mudança na disposição dos painéis (histórico separado do da timeline) |
| `Ctrl + Alt + Shift + Z` | Refazer Mudança de Layout | Refaz a mudança de layout desfeita anteriormente |
| `Num 1` | Timeline: Expansão Direcional Esquerda | Alterna a expansão da timeline sob a sidebar esquerda (bottom-left ↔ center) |
| `Alt + Num 1` | Timeline: Toggle Cabeçalho de Pistas | Oculta ou exibe a área de faixas e timecode da timeline (Track Headers) |
| `Num 2` | Timeline: Alternar Centro ↔ Faixa Total | Alterna a timeline entre entre menus (center) e largura total na base (bottom-full) |
| `Alt + Num 2` | Timeline: Recolher / Restaurar Verticalmente | Recolhe ou expande o painel da timeline para a linha restauradora na base |
| `Ctrl + Num 2` | Timeline: Destacar / Reanexar Janela | Abre a timeline em janela flutuante para o segundo monitor ou a reanexa |
| `Num 3` | Timeline: Expansão Direcional Direita | Alterna a expansão da timeline sob a sidebar direita (bottom-right ↔ center) |
| `Alt + Num 3` | Timeline: Toggle Barra de Ferramentas | Recolhe ou expande a barra vertical de ferramentas de corte (V, C, Trims) |
| `Num 4` | Biblioteca: Ocultar / Exibir | Recolhe ou expande a sidebar esquerda (Biblioteca de mídias, temas, rostos) |
| `Alt + Num 4` | Biblioteca: Layout Estúdio (Maximizar) | Maximiza a biblioteca no layout estúdio com timeline e players empilhados |
| `Ctrl + Num 4` | Biblioteca: Destacar / Reanexar Janela | Abre a biblioteca em janela flutuante externa ou a reanexa |
| `Num 5` | Inspetor: Ocultar / Exibir | Recolhe ou expande o painel de Ajustes & Efeitos (Inspetor) |
| `Alt + Num 5` | Inspetor: Maximizar / Restaurar | Maximiza o painel de Ajustes & Efeitos no espaço disponível |
| `Ctrl + Num 5` | Inspetor: Destacar / Reanexar Janela | Abre o Inspetor em janela flutuante externa ou o reanexa |
| `Num 6` | Painel Direito: Ocultar / Exibir | Recolhe ou expande a sidebar direita (Transcrição, Visão IA, Tarefas, Logs) |
| `Alt + Num 6` | Painel Direito: Maximizar / Restaurar | Maximiza a sidebar direita no espaço disponível |
| `Ctrl + Num 6` | Painel Direito: Destacar / Reanexar Janela | Abre a sidebar direita em janela flutuante externa ou a reanexa |
| `Num 7` | Source Player: Ocultar / Exibir | Oculta ou exibe o monitor de origem (Source Player) |
| `Alt + Num 7` | Source Player: Maximizar / Restaurar | Maximiza o monitor de origem no palco central |
| `Ctrl + Num 7` | Source Player: Destacar / Reanexar Janela | Abre o monitor de origem em janela flutuante externa ou o reanexa |
| `Num 8` | Header Geral: Ocultar / Exibir | Recolhe ou expande o cabeçalho superior da aplicação para ganhar espaço vertical |
| `Num 9` | Program Player: Ocultar / Exibir | Oculta ou exibe o monitor de programa (Program Player) |
| `Alt + Num 9` | Program Player: Maximizar / Restaurar | Maximiza o monitor de programa no palco central |
| `Ctrl + Num 9` | Program Player: Destacar / Reanexar Janela | Abre o monitor de programa em janela flutuante externa ou o reanexa |
| `Num 0` | Modo Foco / Cinema / Zen | Macro global: recolhe ou restaura Header e todas as Sidebars simultaneamente |
| `Num .` | Timeline: Toggle Cabeçalho Superior | Recolhe ou restaura a barra superior de nome, zoom e sequência da timeline |
| `Num +` | Timeline: Aumentar Altura das Pistas | Aumenta a altura das faixas de áudio e vídeo na timeline (+10px) |
| `Num -` | Timeline: Diminuir Altura das Pistas | Diminui a altura das faixas de áudio e vídeo na timeline (-10px) |
| `Num /` | Monitores: Alternar Lado a Lado / Empilhados | Alterna a disposição dos monitores entre horizontal e vertical |
| `Num *` | Monitores: Swap / Alternar Foco | Alterna o foco ativo entre o Monitor Source e o Monitor Program |
| `Num Enter` | Maximizar / Restaurar Painel sob Foco | Maximiza ou restaura o painel ativo ou sob o cursor |
| `Ctrl + Alt + 1` ou `Ctrl + Alt + Num 1` | Workspace: Carregar Slot 1 | Carrega instantaneamente o layout salvo no slot numérico 1 (Ctrl + Alt + 1) |
| `Ctrl + Alt + 2` ou `Ctrl + Alt + Num 2` | Workspace: Carregar Slot 2 | Carrega instantaneamente o layout salvo no slot numérico 2 (Ctrl + Alt + 2) |
| `Ctrl + Alt + 3` ou `Ctrl + Alt + Num 3` | Workspace: Carregar Slot 3 | Carrega instantaneamente o layout salvo no slot numérico 3 (Ctrl + Alt + 3) |
| `Ctrl + Alt + 4` ou `Ctrl + Alt + Num 4` | Workspace: Carregar Slot 4 | Carrega instantaneamente o layout salvo no slot numérico 4 (Ctrl + Alt + 4) |
| `Ctrl + Alt + 5` ou `Ctrl + Alt + Num 5` | Workspace: Carregar Slot 5 | Carrega instantaneamente o layout salvo no slot numérico 5 (Ctrl + Alt + 5) |
| `Ctrl + Alt + 6` ou `Ctrl + Alt + Num 6` | Workspace: Carregar Slot 6 | Carrega instantaneamente o layout salvo no slot numérico 6 (Ctrl + Alt + 6) |
| `Ctrl + Alt + 7` ou `Ctrl + Alt + Num 7` | Workspace: Carregar Slot 7 | Carrega instantaneamente o layout salvo no slot numérico 7 (Ctrl + Alt + 7) |
| `Ctrl + Alt + 8` ou `Ctrl + Alt + Num 8` | Workspace: Carregar Slot 8 | Carrega instantaneamente o layout salvo no slot numérico 8 (Ctrl + Alt + 8) |
| `Ctrl + Alt + 9` ou `Ctrl + Alt + Num 9` | Workspace: Carregar Slot 9 | Carrega instantaneamente o layout salvo no slot numérico 9 (Ctrl + Alt + 9) |
| `Ctrl + Alt + Shift + 1` ou `Ctrl + Alt + Shift + Num 1` | Workspace: Salvar no Slot 1 | Grava a disposição atual diretamente no slot numérico 1 (Ctrl + Alt + Shift + 1) |
| `Ctrl + Alt + Shift + 2` ou `Ctrl + Alt + Shift + Num 2` | Workspace: Salvar no Slot 2 | Grava a disposição atual diretamente no slot numérico 2 (Ctrl + Alt + Shift + 2) |
| `Ctrl + Alt + Shift + 3` ou `Ctrl + Alt + Shift + Num 3` | Workspace: Salvar no Slot 3 | Grava a disposição atual diretamente no slot numérico 3 (Ctrl + Alt + Shift + 3) |
| `Ctrl + Alt + Shift + 4` ou `Ctrl + Alt + Shift + Num 4` | Workspace: Salvar no Slot 4 | Grava a disposição atual diretamente no slot numérico 4 (Ctrl + Alt + Shift + 4) |
| `Ctrl + Alt + Shift + 5` ou `Ctrl + Alt + Shift + Num 5` | Workspace: Salvar no Slot 5 | Grava a disposição atual diretamente no slot numérico 5 (Ctrl + Alt + Shift + 5) |
| `Ctrl + Alt + Shift + 6` ou `Ctrl + Alt + Shift + Num 6` | Workspace: Salvar no Slot 6 | Grava a disposição atual diretamente no slot numérico 6 (Ctrl + Alt + Shift + 6) |
| `Ctrl + Alt + Shift + 7` ou `Ctrl + Alt + Shift + Num 7` | Workspace: Salvar no Slot 7 | Grava a disposição atual diretamente no slot numérico 7 (Ctrl + Alt + Shift + 7) |
| `Ctrl + Alt + Shift + 8` ou `Ctrl + Alt + Shift + Num 8` | Workspace: Salvar no Slot 8 | Grava a disposição atual diretamente no slot numérico 8 (Ctrl + Alt + Shift + 8) |
| `Ctrl + Alt + Shift + 9` ou `Ctrl + Alt + Shift + Num 9` | Workspace: Salvar no Slot 9 | Grava a disposição atual diretamente no slot numérico 9 (Ctrl + Alt + Shift + 9) |

### Perfil Apple Final Cut Pro

> Alguns atalhos aparecem em mais de uma ação neste perfil. Isso é intencional: a ação executada depende do contexto (painel em foco, ferramenta ativa, elemento sob o mouse, sugestão ou clipe fantasma ativo). A coluna de observação indica com quais ações o atalho é compartilhado.

#### 1. Reprodução & Navegação

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Espaço` | Play / Pause | Inicia ou pausa a reprodução no player ativo (Source ou Program) |
| `J` | Shuttle Reverso (J) | Reproduz para trás. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x) |
| `K` | Shuttle Play / Pause (K) | Alterna entre reproduzir e pausar a reprodução (segure K com J ou L para avançar/recuar quadro a quadro) |
| `L` | Shuttle Avanço (L) | Reproduz para frente. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x) |
| `Shift + →` | Shuttle Acelerado / Avanço Rápido (Shift + →) | Reproduz acelerado para frente. Toques repetidos aumentam a velocidade (igual JKL); segurar reproduz acelerado enquanto pressionado |
| `Shift + ←` | Shuttle Acelerado / Recuo Rápido (Shift + ←) | Reproduz acelerado para trás. Toques repetidos aumentam a velocidade reversa; segurar reproduz acelerado enquanto pressionado |
| `Ctrl + →` | Câmera Lenta Avanço (Ctrl + →) | Reproduz em câmera lenta para frente (0.25x). Segurar reproduz enquanto pressionado |
| `Ctrl + ←` | Câmera Lenta Recuo (Ctrl + ←) | Reproduz em câmera lenta reversa (-0.25x). Segurar reproduz enquanto pressionado |
| `K + J` ou `←` | Jog Recuar 1 Frame (K + J) | Segure K e pressione J para recuar exatamente 1 frame<br>**Atalho compartilhado, depende do contexto:** Navegar 1 Frame para Trás (←). |
| `←` | Navegar 1 Frame para Trás | Move a agulha 1 frame para trás (quando nenhum clipe estiver selecionado)<br>**Atalho compartilhado, depende do contexto:** Jog Recuar 1 Frame (K + J) (←). |
| `K + L` ou `→` | Jog Avançar 1 Frame (K + L) | Segure K e pressione L para avançar exatamente 1 frame<br>**Atalho compartilhado, depende do contexto:** Navegar 1 Frame para Frente (→). |
| `→` | Navegar 1 Frame para Frente | Move a agulha 1 frame para frente (quando nenhum clipe estiver selecionado)<br>**Atalho compartilhado, depende do contexto:** Jog Avançar 1 Frame (K + L) (→). |
| `I` | Marcar Ponto de Entrada (IN) | Define o ponto inicial de corte no Player ou Linha do Tempo |
| `O` | Marcar Ponto de Saída (OUT) | Define o ponto final de corte no Player ou Linha do Tempo |
| `Alt + I` | Limpar Ponto IN | Remove o ponto de entrada (IN) no Player ou Linha do Tempo |
| `Alt + O` | Limpar Ponto OUT | Remove o ponto de saída (OUT) no Player ou Linha do Tempo |
| `Alt + X` | Limpar Pontos IN e OUT | Remove ambos os pontos de entrada e saída (IN e OUT) |
| `X` | Marcar Clipe (IN / OUT) | Define pontos IN e OUT nos limites do clipe selecionado ou sob a agulha |
| `Shift + I` | Ir para o Ponto IN | Move a agulha de reprodução diretamente para o ponto IN |
| `Shift + O` | Ir para o Ponto OUT | Move a agulha de reprodução diretamente para o ponto OUT |
| `Alt + /` ou `Shift + Espaço` | Tocar de IN até OUT | Reproduz o trecho delimitado entre os pontos IN e OUT e pausa |
| `Cmd + L` ou `Ctrl + L` | Alternar Reprodução em Loop | Liga ou desliga a reprodução contínua em loop entre os pontos IN e OUT |
| `E` | Inserir na Timeline (Append) | Insere o trecho marcado (IN ➔ OUT) na timeline |
| `↑` ou `[` | Pular para Ponto Anterior / Início | Program: move a agulha para o corte anterior; Source: vai para IN ou Início |
| `↓` ou `]` | Pular para Próximo Ponto / Fim | Program: move a agulha para o corte seguinte; Source: vai para OUT ou Fim |
| `Ctrl + P` ou `Ctrl + G` | Ir para Timecode / Navegação Numérica | Ativa a entrada de timecode para salto absoluto ou navegação relativa (+/- frames) |

#### 2. Ferramentas & Modos

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `A` | Ferramenta de Seleção | Ativa a ferramenta de seleção padrão da timeline (Seta)<br>**Atalho compartilhado, depende do contexto:** Alternar Tomadas / Alternativas de IA (A). |
| `Shift + A` | Seleção por Caixa / Retângulo (Marquee) | Ativa a ferramenta de seleção por retângulo (arraste para selecionar clipes e marcadores) |
| `B` | Ferramenta Lâmina / Gilete (Blade) | Ativa a ferramenta de corte de precisão por cursor na trilha |
| `Shift + B` ou `Cmd + Shift + B` ou `Ctrl + Shift + B` | Lâmina Global na Agulha | Fatia todas as pistas destravadas na coordenada da agulha de reprodução |
| `Y` | Deslizar Conteúdo Interno (Slip Tool) | Desliza os pontos IN e OUT da mídia bruta mantendo a posição e duração na timeline<br>**Atalho compartilhado, depende do contexto:** Alternar Tomadas / Alternativas de IA (Y); Aceitar Sugestão de IA (Y). |
| `U` | Deslizar Posição na Timeline (Slide Tool) | Move o clipe na timeline mantendo seu conteúdo intacto e compensando nos vizinhos adjacentes |
| `N` ou `T` | Corte Contínuo Adjacente (Rolling Edit) | Ajusta o ponto de corte entre dois clipes contíguos sem alterar a duração total da sequência<br>**Atalho compartilhado, depende do contexto:** Rejeitar Sugestão de IA (N). |
| `R` | Esticar / Comprimir Taxa de Velocidade (Rate Stretch) | Altera a velocidade do clipe arrastando suas bordas para esticar ou comprimir a taxa temporal<br>**Atalho compartilhado, depende do contexto:** Girar Mídia sob Cursor (+90°) (R). |
| `R` | Girar Mídia sob Cursor (+90°) | Rotaciona a mídia sob o cursor (hover) na biblioteca ou no monitor de origem<br>**Atalho compartilhado, depende do contexto:** Esticar / Comprimir Taxa de Velocidade (Rate Stretch) (R). |
| `P` | Selecionar Faixa para Frente | Ativa a ferramenta de seleção de todos os clipes à direita |
| `Shift + P` | Selecionar Faixa para Trás | Ativa a ferramenta de seleção de todos os clipes à esquerda |
| `Shift + N` ou `S` | Alternar Snapping Magnético | Liga ou desliga o alinhamento magnético inteligente de bordas e agulha |
| `H` | Ferramenta Mão / Pan | Ativa a ferramenta de navegação e arrasto contínuo da timeline (Pan) |
| `Z` | Ferramenta Zoom / Lupa | Ativa a ferramenta de aproximação e afastamento por clique |
| `Esc` | Desmarcar Seleção / Fechar Caixas | Limpa a seleção de clipes ou fecha pop-ups contextuais e modais |

#### 3. Edição, Cortes & Trims

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `W` ou `,` | Inserir na Agulha (Ripple Insert) | Insere o trecho marcado no monitor Source na coordenada da agulha empurrando os clipes subsequentes |
| `D` ou `.` | Sobrescrever na Agulha (Overwrite Edit) | Insere o trecho marcado no monitor Source na coordenada da agulha substituindo o material sob o intervalo<br>**Atalho compartilhado, depende do contexto:** Selecionar Clipe sob a Agulha (D). |
| `D` | Selecionar Clipe sob a Agulha | Seleciona o clipe na trilha ativa posicionado sob a agulha de reprodução (D)<br>**Atalho compartilhado, depende do contexto:** Sobrescrever na Agulha (Overwrite Edit) (D). |
| `Ctrl + Alt + A` | Alternar Canais na Inserção (AV / V / A) | Alterna os canais transferidos do monitor Source para a Timeline: Áudio+Vídeo (AV), Somente Vídeo (V) ou Somente Áudio (A) |
| `Shift + F` | Localizar Quadro Original na Fonte (Match Frame) | Localiza a mídia bruta correspondente ao quadro sob a agulha da timeline e abre no Source Player marcando os pontos IN–OUT originais |
| `Alt + F` | Localizar Quadro na Timeline (Reverse Match Frame) | Localiza onde o quadro atual sob a agulha do Source Player está sendo utilizado na timeline ativa e salta a agulha para a posição correspondente |
| `Ctrl + Shift + R` | Substituir Clipe na Timeline (Replace Edit) | Substitui a mídia do clipe alvo (selecionado, sob a agulha ou sob o cursor com Alt no arraste) preservando duração exata, efeitos (Ken Burns), cor e velocidade |
| `Ctrl + U` | Criar Subclipe na Biblioteca (Make Subclip) | Gera um novo item virtual na biblioteca a partir do intervalo [IN–OUT] delimitado no monitor Source |
| `Ctrl + Shift + F` | Congelar Quadro (Freeze Frame) | Captura o quadro sob a agulha e insere um segmento estático na timeline (Ctrl+Shift+F) |
| `Ctrl + R` ou `Cmd + R` | Velocidade / Duração do Clipe (Speed / Duration) | Abre o diálogo de velocidade percentual, duração proporcional e reversão do clipe selecionado (Ctrl+R)<br>**Atalho compartilhado, depende do contexto:** Renderizar Efeitos In para Out (Cache NLE) (Ctrl + R). |
| `Enter` ou `Ctrl + R` | Renderizar Efeitos In para Out (Cache NLE) | Pré-renderiza o intervalo da timeline (In-Out ou trechos pesados) para playback suave em cache (Enter)<br>**Atalho compartilhado, depende do contexto:** Aceitar Sugestão de IA (Enter); Velocidade / Duração do Clipe (Speed / Duration) (Ctrl + R). |
| `Ctrl + Alt + R` ou `Cmd + Alt + R` | Preencher Espaço na Trilha (Fit to Gap) | Estende a duração do clipe ajustando a velocidade para preencher automaticamente o espaço vazio adjacente na pista (Ctrl+Alt+R) |
| `Alt + Cmd + T` ou `Ctrl + Shift + D` | Crossfade de Áudio (Potência Constante) | Aplica transição de crossfade de áudio de potência constante (Equal-Power) na emenda entre clipes contíguos ou no clipe selecionado (Ctrl+Shift+D) |
| `Cmd + T` ou `Ctrl + D` | Transição de Vídeo Padrão (Cross Dissolve) | Aplica transição de vídeo (Cross Dissolve, Dip to Black ou Dip to White) na emenda contígua sob a agulha ou entre os clipes selecionados (Ctrl+D) |
| `Cmd + B` | Dividir Clipe no Playhead (Split) | Fatia o clipe sob a agulha de reprodução (ou o clipe selecionado) |
| `Alt + [` ou `Q` | Ripple Trim Início (Até a Agulha) | Corta o início do clipe até a agulha e fecha o espaço na timeline |
| `Alt + ]` | Ripple Trim Fim (Da Agulha ao Fim) | Corta da agulha até o final do clipe e fecha o espaço na timeline |
| `Del` | Lift Delete (Apagar Clipe) | Apaga o clipe selecionado deixando o espaço vazio (gap) intacto<br>**Atalho compartilhado, depende do contexto:** Lift no Intervalo IN–OUT (Del); Rejeitar Sugestão de IA (Del). |
| `Del` ou `Semicolon` | Lift no Intervalo IN–OUT | Apaga o conteúdo dentro do intervalo IN–OUT nas pistas ativas deixando o espaço vazio (gap)<br>**Atalho compartilhado, depende do contexto:** Lift Delete (Apagar Clipe) (Del); Rejeitar Sugestão de IA (Del). |
| `Shift + Del` ou `Backspace` | Ripple Delete (Apagar e Fechar Espaço) | Apaga o clipe e puxa todos os clipes posteriores para fechar a lacuna<br>**Atalho compartilhado, depende do contexto:** Extract (Ripple Delete) no Intervalo IN–OUT (Shift + Del). |
| `Shift + Del` ou `Quote` | Extract (Ripple Delete) no Intervalo IN–OUT | Apaga o conteúdo dentro do intervalo IN–OUT e puxa os clipes posteriores para fechar o espaço<br>**Atalho compartilhado, depende do contexto:** Ripple Delete (Apagar e Fechar Espaço) (Shift + Del). |
| `Alt + Del` | Apagar Faixa Única (Desvincular Par) | Apaga apenas o vídeo ou o áudio selecionado, preservando o outro fluxo |
| `Cmd + Shift + S` ou `Ctrl + Shift + S` | Desvincular Par Áudio/Vídeo | Quebra a vinculação estrita entre o vídeo e seu par de áudio correspondente<br>**Atalho compartilhado, depende do contexto:** Salvar Preset de Workspace (Ctrl + Shift + S). |
| `Alt + ←` | Nudge: Deslocar 1 Frame para Trás | Move o clipe selecionado 1 frame para a esquerda na timeline |
| `Alt + →` | Nudge: Deslocar 1 Frame para Frente | Move o clipe selecionado 1 frame para a direita na timeline |
| `Shift + ,` | Trim Ponto IN: Recuar 1 Frame | Expande ou contrai a ponta inicial do clipe selecionado em 1 frame |
| `Shift + .` | Trim Ponto IN: Avançar 1 Frame | Avança a ponta inicial do clipe selecionado em 1 frame |
| `Alt + ,` | Trim Ponto OUT: Recuar 1 Frame | Recua a ponta final do clipe selecionado em 1 frame |
| `Alt + .` | Trim Ponto OUT: Avançar 1 Frame | Avança a ponta final do clipe selecionado em 1 frame |
| `Shift + D` | Multi-Seleção na Agulha (Adicionar à Seleção) | Seleciona todos os clipes sob a agulha em todas as pistas e adiciona à seleção existente (Shift+D) |
| `V` | Ativar / Desativar Clipe (Mute / Bypass) | Alterna se o clipe selecionado (ou sob a agulha) está ativo ou desativado |

#### 4. Marcadores

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `M` | Adicionar / Editar Marcador | Cria um novo marcador ou abre o popover de edição rápida no playhead |
| `Ctrl + Quote` ou `Shift + M` | Pular para o Próximo Marcador | Avança a agulha de reprodução até o marcador seguinte na timeline |
| `Ctrl + Semicolon` ou `Alt + M` | Pular para o Marcador Anterior | Recua a agulha de reprodução até o marcador anterior na timeline |
| `Ctrl + Shift + K` | Alternar Momento Crucial (Player / Galeria) | Marca ou desmarca o quadro atual como Momento Crucial para reprodução rápida em hover |

#### 5. Assistência de IA & Tomadas

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Alt + B` | Alternar Detecção Facial no Source | Exibe ou oculta a camada visual de caixas de detecção facial e grounding no Monitor de Origem (Source) |
| `Y` ou `A` | Alternar Tomadas / Alternativas de IA | Abre o seletor de tomadas alternativas em clipes gerados por IA / Inspetor<br>**Atalho compartilhado, depende do contexto:** Deslizar Conteúdo Interno (Slip Tool) (Y); Aceitar Sugestão de IA (Y); Ferramenta de Seleção (A). |
| `Enter` ou `Y` | Aceitar Sugestão de IA | Aprova a sugestão da faixa fantasma de IA, tornando-a clipe real na trilha<br>**Atalho compartilhado, depende do contexto:** Renderizar Efeitos In para Out (Cache NLE) (Enter); Deslizar Conteúdo Interno (Slip Tool) (Y); Alternar Tomadas / Alternativas de IA (Y). |
| `Del` ou `N` | Rejeitar Sugestão de IA | Descarta e remove a sugestão fantasma da timeline<br>**Atalho compartilhado, depende do contexto:** Lift Delete (Apagar Clipe) (Del); Lift no Intervalo IN–OUT (Del); Corte Contínuo Adjacente (Rolling Edit) (N). |

#### 6. Canvas, Zoom & Histórico

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Shift + Z` | Ajustar Sequência na Tela (Zoom to Fit) | Enquadra perfeitamente todos os clipes na timeline ou restaura o zoom anterior (Toggle) |
| `Cmd + + / =` ou `Ctrl + + / =` | Aumentar Zoom na Linha do Tempo | Aproxima o zoom horizontal da régua e clipes da timeline |
| `Cmd + -` ou `Ctrl + -` | Diminuir Zoom na Linha do Tempo | Afasta o zoom horizontal da régua e clipes da timeline |
| `Shift + 1` | Restaurar Zoom Padrão (1:1 / 0.5 px/f) | Restaura a escala da régua e dos clipes para o zoom padrão de 0.5 pixels por frame |
| `Ctrl + Alt + P` | Alternar 'Seleção Acompanha a Agulha' | Ativa ou desativa a seleção automática do clipe sob a agulha ao se mover |
| `Ctrl + Alt + F` | Alternar 'Timeline Segue a Agulha' (Auto-Scroll) | Ativa ou desativa a rolagem automática da timeline para acompanhar o cursor de reprodução |
| `Shift + L` | Travar / Destravar Pista Ativa (Track Lock) | Ativa ou desativa o cadeado físico de proteção total na pista selecionada |
| `Ctrl + Alt + Shift + L` | Travar / Destravar Todas as Pistas | Alterna o cadeado físico em todas as pistas de vídeo, áudio e texto da timeline |
| `Ctrl + Shift + G` | Alternar Margens de Segurança & Guias no Player (Safe Margins) | Exibe ou oculta o overlay vetorial de Action Safe (90%), Title Safe (80%), Cruz Central e Máscaras de Proporção no Monitor de Programa |
| `Ctrl + Alt + G` | Alternar Máscara de Proporção no Player (16:9 / 9:16 / 1:1 / 2.39:1) | Alterna ciclicamente entre as máscaras de proporção de aspecto (16:9, 9:16, 1:1, 2.39:1, 4:5, 4:3, Sem Máscara) no Monitor de Programa |
| `Ctrl + Z` | Desfazer Ação (Undo) | Desfaz a última alteração realizada na timeline |
| `Ctrl + Shift + Z` ou `Ctrl + Y` | Refazer Ação (Redo) | Refaz a edição desfeita anteriormente |
| `Ctrl + Shift + S` | Salvar Preset de Workspace | Abre o diálogo para salvar o layout visual atual da interface<br>**Atalho compartilhado, depende do contexto:** Desvincular Par Áudio/Vídeo (Ctrl + Shift + S). |

#### 7. Layout & Workspace (Numpad)

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Alt + Z` | Desfazer Mudança de Layout | Desfaz a última mudança na disposição dos painéis (histórico separado do da timeline) |
| `Ctrl + Alt + Shift + Z` | Refazer Mudança de Layout | Refaz a mudança de layout desfeita anteriormente |
| `Num 1` | Timeline: Expansão Direcional Esquerda | Alterna a expansão da timeline sob a sidebar esquerda (bottom-left ↔ center) |
| `Alt + Num 1` | Timeline: Toggle Cabeçalho de Pistas | Oculta ou exibe a área de faixas e timecode da timeline (Track Headers) |
| `Num 2` | Timeline: Alternar Centro ↔ Faixa Total | Alterna a timeline entre entre menus (center) e largura total na base (bottom-full) |
| `Alt + Num 2` | Timeline: Recolher / Restaurar Verticalmente | Recolhe ou expande o painel da timeline para a linha restauradora na base |
| `Ctrl + Num 2` | Timeline: Destacar / Reanexar Janela | Abre a timeline em janela flutuante para o segundo monitor ou a reanexa |
| `Num 3` | Timeline: Expansão Direcional Direita | Alterna a expansão da timeline sob a sidebar direita (bottom-right ↔ center) |
| `Alt + Num 3` | Timeline: Toggle Barra de Ferramentas | Recolhe ou expande a barra vertical de ferramentas de corte (V, C, Trims) |
| `Num 4` | Biblioteca: Ocultar / Exibir | Recolhe ou expande a sidebar esquerda (Biblioteca de mídias, temas, rostos) |
| `Alt + Num 4` | Biblioteca: Layout Estúdio (Maximizar) | Maximiza a biblioteca no layout estúdio com timeline e players empilhados |
| `Ctrl + Num 4` | Biblioteca: Destacar / Reanexar Janela | Abre a biblioteca em janela flutuante externa ou a reanexa |
| `Num 5` | Inspetor: Ocultar / Exibir | Recolhe ou expande o painel de Ajustes & Efeitos (Inspetor) |
| `Alt + Num 5` | Inspetor: Maximizar / Restaurar | Maximiza o painel de Ajustes & Efeitos no espaço disponível |
| `Ctrl + Num 5` | Inspetor: Destacar / Reanexar Janela | Abre o Inspetor em janela flutuante externa ou o reanexa |
| `Num 6` | Painel Direito: Ocultar / Exibir | Recolhe ou expande a sidebar direita (Transcrição, Visão IA, Tarefas, Logs) |
| `Alt + Num 6` | Painel Direito: Maximizar / Restaurar | Maximiza a sidebar direita no espaço disponível |
| `Ctrl + Num 6` | Painel Direito: Destacar / Reanexar Janela | Abre a sidebar direita em janela flutuante externa ou a reanexa |
| `Num 7` | Source Player: Ocultar / Exibir | Oculta ou exibe o monitor de origem (Source Player) |
| `Alt + Num 7` | Source Player: Maximizar / Restaurar | Maximiza o monitor de origem no palco central |
| `Ctrl + Num 7` | Source Player: Destacar / Reanexar Janela | Abre o monitor de origem em janela flutuante externa ou o reanexa |
| `Num 8` | Header Geral: Ocultar / Exibir | Recolhe ou expande o cabeçalho superior da aplicação para ganhar espaço vertical |
| `Num 9` | Program Player: Ocultar / Exibir | Oculta ou exibe o monitor de programa (Program Player) |
| `Alt + Num 9` | Program Player: Maximizar / Restaurar | Maximiza o monitor de programa no palco central |
| `Ctrl + Num 9` | Program Player: Destacar / Reanexar Janela | Abre o monitor de programa em janela flutuante externa ou o reanexa |
| `Num 0` | Modo Foco / Cinema / Zen | Macro global: recolhe ou restaura Header e todas as Sidebars simultaneamente |
| `Num .` | Timeline: Toggle Cabeçalho Superior | Recolhe ou restaura a barra superior de nome, zoom e sequência da timeline |
| `Num +` | Timeline: Aumentar Altura das Pistas | Aumenta a altura das faixas de áudio e vídeo na timeline (+10px) |
| `Num -` | Timeline: Diminuir Altura das Pistas | Diminui a altura das faixas de áudio e vídeo na timeline (-10px) |
| `Num /` | Monitores: Alternar Lado a Lado / Empilhados | Alterna a disposição dos monitores entre horizontal e vertical |
| `Num *` | Monitores: Swap / Alternar Foco | Alterna o foco ativo entre o Monitor Source e o Monitor Program |
| `Num Enter` | Maximizar / Restaurar Painel sob Foco | Maximiza ou restaura o painel ativo ou sob o cursor |
| `Ctrl + Alt + 1` ou `Ctrl + Alt + Num 1` | Workspace: Carregar Slot 1 | Carrega instantaneamente o layout salvo no slot numérico 1 (Ctrl + Alt + 1) |
| `Ctrl + Alt + 2` ou `Ctrl + Alt + Num 2` | Workspace: Carregar Slot 2 | Carrega instantaneamente o layout salvo no slot numérico 2 (Ctrl + Alt + 2) |
| `Ctrl + Alt + 3` ou `Ctrl + Alt + Num 3` | Workspace: Carregar Slot 3 | Carrega instantaneamente o layout salvo no slot numérico 3 (Ctrl + Alt + 3) |
| `Ctrl + Alt + 4` ou `Ctrl + Alt + Num 4` | Workspace: Carregar Slot 4 | Carrega instantaneamente o layout salvo no slot numérico 4 (Ctrl + Alt + 4) |
| `Ctrl + Alt + 5` ou `Ctrl + Alt + Num 5` | Workspace: Carregar Slot 5 | Carrega instantaneamente o layout salvo no slot numérico 5 (Ctrl + Alt + 5) |
| `Ctrl + Alt + 6` ou `Ctrl + Alt + Num 6` | Workspace: Carregar Slot 6 | Carrega instantaneamente o layout salvo no slot numérico 6 (Ctrl + Alt + 6) |
| `Ctrl + Alt + 7` ou `Ctrl + Alt + Num 7` | Workspace: Carregar Slot 7 | Carrega instantaneamente o layout salvo no slot numérico 7 (Ctrl + Alt + 7) |
| `Ctrl + Alt + 8` ou `Ctrl + Alt + Num 8` | Workspace: Carregar Slot 8 | Carrega instantaneamente o layout salvo no slot numérico 8 (Ctrl + Alt + 8) |
| `Ctrl + Alt + 9` ou `Ctrl + Alt + Num 9` | Workspace: Carregar Slot 9 | Carrega instantaneamente o layout salvo no slot numérico 9 (Ctrl + Alt + 9) |
| `Ctrl + Alt + Shift + 1` ou `Ctrl + Alt + Shift + Num 1` | Workspace: Salvar no Slot 1 | Grava a disposição atual diretamente no slot numérico 1 (Ctrl + Alt + Shift + 1) |
| `Ctrl + Alt + Shift + 2` ou `Ctrl + Alt + Shift + Num 2` | Workspace: Salvar no Slot 2 | Grava a disposição atual diretamente no slot numérico 2 (Ctrl + Alt + Shift + 2) |
| `Ctrl + Alt + Shift + 3` ou `Ctrl + Alt + Shift + Num 3` | Workspace: Salvar no Slot 3 | Grava a disposição atual diretamente no slot numérico 3 (Ctrl + Alt + Shift + 3) |
| `Ctrl + Alt + Shift + 4` ou `Ctrl + Alt + Shift + Num 4` | Workspace: Salvar no Slot 4 | Grava a disposição atual diretamente no slot numérico 4 (Ctrl + Alt + Shift + 4) |
| `Ctrl + Alt + Shift + 5` ou `Ctrl + Alt + Shift + Num 5` | Workspace: Salvar no Slot 5 | Grava a disposição atual diretamente no slot numérico 5 (Ctrl + Alt + Shift + 5) |
| `Ctrl + Alt + Shift + 6` ou `Ctrl + Alt + Shift + Num 6` | Workspace: Salvar no Slot 6 | Grava a disposição atual diretamente no slot numérico 6 (Ctrl + Alt + Shift + 6) |
| `Ctrl + Alt + Shift + 7` ou `Ctrl + Alt + Shift + Num 7` | Workspace: Salvar no Slot 7 | Grava a disposição atual diretamente no slot numérico 7 (Ctrl + Alt + Shift + 7) |
| `Ctrl + Alt + Shift + 8` ou `Ctrl + Alt + Shift + Num 8` | Workspace: Salvar no Slot 8 | Grava a disposição atual diretamente no slot numérico 8 (Ctrl + Alt + Shift + 8) |
| `Ctrl + Alt + Shift + 9` ou `Ctrl + Alt + Shift + Num 9` | Workspace: Salvar no Slot 9 | Grava a disposição atual diretamente no slot numérico 9 (Ctrl + Alt + Shift + 9) |

### Perfil Kdenlive

> Alguns atalhos aparecem em mais de uma ação neste perfil. Isso é intencional: a ação executada depende do contexto (painel em foco, ferramenta ativa, elemento sob o mouse, sugestão ou clipe fantasma ativo). A coluna de observação indica com quais ações o atalho é compartilhado.

#### 1. Reprodução & Navegação

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Espaço` | Play / Pause | Inicia ou pausa a reprodução no player ativo (Source ou Program) |
| `J` | Shuttle Reverso (J) | Reproduz para trás. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x) |
| `K` | Shuttle Play / Pause (K) | Alterna entre reproduzir e pausar a reprodução (segure K com J ou L para avançar/recuar quadro a quadro) |
| `L` | Shuttle Avanço (L) | Reproduz para frente. Pressionar repetidamente acelera a velocidade (1x, 2x, 4x, 8x) |
| `Shift + →` | Shuttle Acelerado / Avanço Rápido (Shift + →) | Reproduz acelerado para frente. Toques repetidos aumentam a velocidade (igual JKL); segurar reproduz acelerado enquanto pressionado |
| `Shift + ←` | Shuttle Acelerado / Recuo Rápido (Shift + ←) | Reproduz acelerado para trás. Toques repetidos aumentam a velocidade reversa; segurar reproduz acelerado enquanto pressionado |
| `Ctrl + →` | Câmera Lenta Avanço (Ctrl + →) | Reproduz em câmera lenta para frente (0.25x). Segurar reproduz enquanto pressionado |
| `Ctrl + ←` | Câmera Lenta Recuo (Ctrl + ←) | Reproduz em câmera lenta reversa (-0.25x). Segurar reproduz enquanto pressionado |
| `K + J` ou `←` | Jog Recuar 1 Frame (K + J) | Segure K e pressione J para recuar exatamente 1 frame<br>**Atalho compartilhado, depende do contexto:** Navegar 1 Frame para Trás (←); Nudge: Deslocar 1 Frame para Trás (←). |
| `←` | Navegar 1 Frame para Trás | Move a agulha 1 frame para trás (quando nenhum clipe estiver selecionado)<br>**Atalho compartilhado, depende do contexto:** Jog Recuar 1 Frame (K + J) (←); Nudge: Deslocar 1 Frame para Trás (←). |
| `K + L` ou `→` | Jog Avançar 1 Frame (K + L) | Segure K e pressione L para avançar exatamente 1 frame<br>**Atalho compartilhado, depende do contexto:** Navegar 1 Frame para Frente (→); Nudge: Deslocar 1 Frame para Frente (→). |
| `→` | Navegar 1 Frame para Frente | Move a agulha 1 frame para frente (quando nenhum clipe estiver selecionado)<br>**Atalho compartilhado, depende do contexto:** Jog Avançar 1 Frame (K + L) (→); Nudge: Deslocar 1 Frame para Frente (→). |
| `I` | Marcar Ponto de Entrada (IN) | Define o ponto inicial de corte no Player ou Linha do Tempo |
| `O` | Marcar Ponto de Saída (OUT) | Define o ponto final de corte no Player ou Linha do Tempo |
| `Ctrl + Shift + I` ou `Alt + I` | Limpar Ponto IN | Remove o ponto de entrada (IN) no Player ou Linha do Tempo |
| `Ctrl + Shift + O` ou `Alt + O` | Limpar Ponto OUT | Remove o ponto de saída (OUT) no Player ou Linha do Tempo |
| `Alt + X` ou `Ctrl + Shift + A` | Limpar Pontos IN e OUT | Remove ambos os pontos de entrada e saída (IN e OUT) |
| `X` | Marcar Clipe (IN / OUT) | Define pontos IN e OUT nos limites do clipe selecionado ou sob a agulha<br>**Atalho compartilhado, depende do contexto:** Dividir Clipe no Playhead (Split) (X). |
| `Shift + I` | Ir para o Ponto IN | Move a agulha de reprodução diretamente para o ponto IN |
| `Shift + O` | Ir para o Ponto OUT | Move a agulha de reprodução diretamente para o ponto OUT |
| `Shift + Espaço` | Tocar de IN até OUT | Reproduz o trecho delimitado entre os pontos IN e OUT e pausa |
| `Ctrl + Shift + Espaço` ou `Ctrl + L` | Alternar Reprodução em Loop | Liga ou desliga a reprodução contínua em loop entre os pontos IN e OUT<br>**Atalho compartilhado, depende do contexto:** Ajustar Sequência na Tela (Zoom to Fit) (Ctrl + Shift + Espaço); Desvincular Par Áudio/Vídeo (Ctrl + L). |
| `E` | Inserir na Timeline (Append) | Insere o trecho marcado (IN ➔ OUT) na timeline |
| `Alt + ←` ou `↑` | Pular para Ponto Anterior / Início | Program: move a agulha para o corte anterior; Source: vai para IN ou Início<br>**Atalho compartilhado, depende do contexto:** Trim Ponto IN: Recuar 1 Frame (Alt + ←). |
| `Alt + →` ou `↓` | Pular para Próximo Ponto / Fim | Program: move a agulha para o corte seguinte; Source: vai para OUT ou Fim<br>**Atalho compartilhado, depende do contexto:** Trim Ponto IN: Avançar 1 Frame (Alt + →). |
| `Ctrl + G` | Ir para Timecode / Navegação Numérica | Ativa a entrada de timecode para salto absoluto ou navegação relativa (+/- frames) |

#### 2. Ferramentas & Modos

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `S` | Ferramenta de Seleção | Ativa a ferramenta de seleção padrão da timeline (Seta)<br>**Atalho compartilhado, depende do contexto:** Alternar Snapping Magnético (S). |
| `F10` ou `S` | Alternar Snapping Magnético | Liga ou desliga o alinhamento magnético inteligente de bordas e agulha<br>**Atalho compartilhado, depende do contexto:** Ferramenta de Seleção (S). |
| `Shift + S` | Seleção por Caixa / Retângulo (Marquee) | Ativa a ferramenta de seleção por retângulo (arraste para selecionar clipes e marcadores) |
| `C` | Ferramenta Lâmina / Gilete (Blade) | Ativa a ferramenta de corte de precisão por cursor na trilha |
| `Shift + C` | Lâmina Global na Agulha | Fatia todas as pistas destravadas na coordenada da agulha de reprodução |
| `Y` | Deslizar Conteúdo Interno (Slip Tool) | Desliza os pontos IN e OUT da mídia bruta mantendo a posição e duração na timeline<br>**Atalho compartilhado, depende do contexto:** Aceitar Sugestão de IA (Y). |
| `U` | Deslizar Posição na Timeline (Slide Tool) | Move o clipe na timeline mantendo seu conteúdo intacto e compensando nos vizinhos adjacentes<br>**Atalho compartilhado, depende do contexto:** Crossfade de Áudio (Potência Constante) (U). |
| `N` | Corte Contínuo Adjacente (Rolling Edit) | Ajusta o ponto de corte entre dois clipes contíguos sem alterar a duração total da sequência<br>**Atalho compartilhado, depende do contexto:** Rejeitar Sugestão de IA (N). |
| `Shift + R` | Esticar / Comprimir Taxa de Velocidade (Rate Stretch) | Altera a velocidade do clipe arrastando suas bordas para esticar ou comprimir a taxa temporal<br>**Atalho compartilhado, depende do contexto:** Dividir Clipe no Playhead (Split) (Shift + R). |
| `M` | Selecionar Faixa para Frente | Ativa a ferramenta de seleção de todos os clipes à direita<br>**Atalho compartilhado, depende do contexto:** Adicionar / Editar Marcador (M). |
| `Shift + M` | Selecionar Faixa para Trás | Ativa a ferramenta de seleção de todos os clipes à esquerda<br>**Atalho compartilhado, depende do contexto:** Pular para o Próximo Marcador (Shift + M). |
| `H` | Ferramenta Mão / Pan | Ativa a ferramenta de navegação e arrasto contínuo da timeline (Pan) |
| `Z` | Ferramenta Zoom / Lupa | Ativa a ferramenta de aproximação e afastamento por clique |
| `Esc` | Desmarcar Seleção / Fechar Caixas | Limpa a seleção de clipes ou fecha pop-ups contextuais e modais |
| `R` | Girar Mídia sob Cursor (+90°) | Rotaciona a mídia sob o cursor (hover) na biblioteca ou no monitor de origem |

#### 3. Edição, Cortes & Trims

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `V` ou `,` | Inserir na Agulha (Ripple Insert) | Insere o trecho marcado no monitor Source na coordenada da agulha empurrando os clipes subsequentes |
| `B` ou `.` | Sobrescrever na Agulha (Overwrite Edit) | Insere o trecho marcado no monitor Source na coordenada da agulha substituindo o material sob o intervalo<br>**Atalho compartilhado, depende do contexto:** Restaurar Zoom Padrão (1:1 / 0.5 px/f) (.). |
| `Ctrl + Alt + A` | Alternar Canais na Inserção (AV / V / A) | Alterna os canais transferidos do monitor Source para a Timeline: Áudio+Vídeo (AV), Somente Vídeo (V) ou Somente Áudio (A) |
| `Alt + F` | Localizar Quadro Original na Fonte (Match Frame) | Localiza a mídia bruta correspondente ao quadro sob a agulha da timeline e abre no Source Player marcando os pontos IN–OUT originais |
| `Shift + F` | Localizar Quadro na Timeline (Reverse Match Frame) | Localiza onde o quadro atual sob a agulha do Source Player está sendo utilizado na timeline ativa e salta a agulha para a posição correspondente |
| `Ctrl + Shift + R` | Substituir Clipe na Timeline (Replace Edit) | Substitui a mídia do clipe alvo (selecionado, sob a agulha ou sob o cursor com Alt no arraste) preservando duração exata, efeitos (Ken Burns), cor e velocidade |
| `Ctrl + U` | Criar Subclipe na Biblioteca (Make Subclip) | Gera um novo item virtual na biblioteca a partir do intervalo [IN–OUT] delimitado no monitor Source |
| `Ctrl + Shift + F` | Congelar Quadro (Freeze Frame) | Captura o quadro sob a agulha e insere um segmento estático na timeline (Ctrl+Shift+F) |
| `Ctrl + R` | Velocidade / Duração do Clipe (Speed / Duration) | Abre o diálogo de velocidade percentual, duração proporcional e reversão do clipe selecionado (Ctrl+R) |
| `Ctrl + Alt + R` | Preencher Espaço na Trilha (Fit to Gap) | Estende a duração do clipe ajustando a velocidade para preencher automaticamente o espaço vazio adjacente na pista (Ctrl+Alt+R) |
| `Ctrl + Shift + D` ou `U` | Crossfade de Áudio (Potência Constante) | Aplica transição de crossfade de áudio de potência constante (Equal-Power) na emenda entre clipes contíguos ou no clipe selecionado (Ctrl+Shift+D)<br>**Atalho compartilhado, depende do contexto:** Deslizar Posição na Timeline (Slide Tool) (U). |
| `Ctrl + D` | Transição de Vídeo Padrão (Cross Dissolve) | Aplica transição de vídeo (Cross Dissolve, Dip to Black ou Dip to White) na emenda contígua sob a agulha ou entre os clipes selecionados (Ctrl+D) |
| `Enter` | Renderizar Efeitos In para Out (Cache NLE) | Pré-renderiza o intervalo da timeline (In-Out ou trechos pesados) para playback suave em cache (Enter)<br>**Atalho compartilhado, depende do contexto:** Aceitar Sugestão de IA (Enter). |
| `Shift + R` ou `X` | Dividir Clipe no Playhead (Split) | Fatia o clipe sob a agulha de reprodução (ou o clipe selecionado)<br>**Atalho compartilhado, depende do contexto:** Esticar / Comprimir Taxa de Velocidade (Rate Stretch) (Shift + R); Marcar Clipe (IN / OUT) (X). |
| `[` ou `Q` | Ripple Trim Início (Até a Agulha) | Corta o início do clipe até a agulha e fecha o espaço na timeline |
| `]` ou `W` | Ripple Trim Fim (Da Agulha ao Fim) | Corta da agulha até o final do clipe e fecha o espaço na timeline |
| `Backspace` | Lift Delete (Apagar Clipe) | Apaga o clipe selecionado deixando o espaço vazio (gap) intacto |
| `Del` ou `Shift + Del` | Ripple Delete (Apagar e Fechar Espaço) | Apaga o clipe e puxa todos os clipes posteriores para fechar a lacuna<br>**Atalho compartilhado, depende do contexto:** Rejeitar Sugestão de IA (Del); Extract (Ripple Delete) no Intervalo IN–OUT (Shift + Del). |
| `Shift + Del` ou `Quote` | Extract (Ripple Delete) no Intervalo IN–OUT | Apaga o conteúdo dentro do intervalo IN–OUT e puxa os clipes posteriores para fechar o espaço<br>**Atalho compartilhado, depende do contexto:** Ripple Delete (Apagar e Fechar Espaço) (Shift + Del). |
| `Alt + Backspace` ou `Semicolon` | Lift no Intervalo IN–OUT | Apaga o conteúdo dentro do intervalo IN–OUT nas pistas ativas deixando o espaço vazio (gap) |
| `Alt + Del` | Apagar Faixa Única (Desvincular Par) | Apaga apenas o vídeo ou o áudio selecionado, preservando o outro fluxo |
| `Ctrl + Shift + U` ou `Ctrl + L` | Desvincular Par Áudio/Vídeo | Quebra a vinculação estrita entre o vídeo e seu par de áudio correspondente<br>**Atalho compartilhado, depende do contexto:** Alternar Reprodução em Loop (Ctrl + L). |
| `←` | Nudge: Deslocar 1 Frame para Trás | Move o clipe selecionado 1 frame para a esquerda na timeline<br>**Atalho compartilhado, depende do contexto:** Jog Recuar 1 Frame (K + J) (←); Navegar 1 Frame para Trás (←). |
| `→` | Nudge: Deslocar 1 Frame para Frente | Move o clipe selecionado 1 frame para a direita na timeline<br>**Atalho compartilhado, depende do contexto:** Jog Avançar 1 Frame (K + L) (→); Navegar 1 Frame para Frente (→). |
| `Alt + ←` | Trim Ponto IN: Recuar 1 Frame | Expande ou contrai a ponta inicial do clipe selecionado em 1 frame<br>**Atalho compartilhado, depende do contexto:** Pular para Ponto Anterior / Início (Alt + ←). |
| `Alt + →` | Trim Ponto IN: Avançar 1 Frame | Avança a ponta inicial do clipe selecionado em 1 frame<br>**Atalho compartilhado, depende do contexto:** Pular para Próximo Ponto / Fim (Alt + →). |
| `Alt + Shift + ←` | Trim Ponto OUT: Recuar 1 Frame | Recua a ponta final do clipe selecionado em 1 frame |
| `Alt + Shift + →` | Trim Ponto OUT: Avançar 1 Frame | Avança a ponta final do clipe selecionado em 1 frame |
| `D` | Selecionar Clipe sob a Agulha | Seleciona o clipe na trilha ativa posicionado sob a agulha de reprodução (D) |
| `Shift + D` | Multi-Seleção na Agulha (Adicionar à Seleção) | Seleciona todos os clipes sob a agulha em todas as pistas e adiciona à seleção existente (Shift+D) |
| `F` | Ativar / Desativar Clipe (Mute / Bypass) | Alterna se o clipe selecionado (ou sob a agulha) está ativo ou desativado |

#### 4. Marcadores

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Num *` ou `G` ou `M` | Adicionar / Editar Marcador | Cria um novo marcador ou abre o popover de edição rápida no playhead<br>**Atalho compartilhado, depende do contexto:** Monitores: Swap / Alternar Foco (Num *); Selecionar Faixa para Frente (M). |
| `Alt + G` ou `Shift + M` | Pular para o Próximo Marcador | Avança a agulha de reprodução até o marcador seguinte na timeline<br>**Atalho compartilhado, depende do contexto:** Selecionar Faixa para Trás (Shift + M). |
| `Alt + Shift + G` ou `Alt + M` | Pular para o Marcador Anterior | Recua a agulha de reprodução até o marcador anterior na timeline |
| `Ctrl + Shift + K` | Alternar Momento Crucial (Player / Galeria) | Marca ou desmarca o quadro atual como Momento Crucial para reprodução rápida em hover |

#### 5. Assistência de IA & Tomadas

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Alt + B` | Alternar Detecção Facial no Source | Exibe ou oculta a camada visual de caixas de detecção facial e grounding no Monitor de Origem (Source) |
| `A` | Alternar Tomadas / Alternativas de IA | Abre o seletor de tomadas alternativas em clipes gerados por IA / Inspetor |
| `Enter` ou `Y` | Aceitar Sugestão de IA | Aprova a sugestão da faixa fantasma de IA, tornando-a clipe real na trilha<br>**Atalho compartilhado, depende do contexto:** Renderizar Efeitos In para Out (Cache NLE) (Enter); Deslizar Conteúdo Interno (Slip Tool) (Y). |
| `Del` ou `N` | Rejeitar Sugestão de IA | Descarta e remove a sugestão fantasma da timeline<br>**Atalho compartilhado, depende do contexto:** Ripple Delete (Apagar e Fechar Espaço) (Del); Corte Contínuo Adjacente (Rolling Edit) (N). |

#### 6. Canvas, Zoom & Histórico

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Shift + Espaço` | Ajustar Sequência na Tela (Zoom to Fit) | Enquadra perfeitamente todos os clipes na timeline ou restaura o zoom anterior (Toggle)<br>**Atalho compartilhado, depende do contexto:** Alternar Reprodução em Loop (Ctrl + Shift + Espaço). |
| `Ctrl + + / =` ou `Ctrl + Num +` | Aumentar Zoom na Linha do Tempo | Aproxima o zoom horizontal da régua e clipes da timeline |
| `Ctrl + -` ou `Ctrl + Num -` | Diminuir Zoom na Linha do Tempo | Afasta o zoom horizontal da régua e clipes da timeline |
| `.` | Restaurar Zoom Padrão (1:1 / 0.5 px/f) | Restaura a escala da régua e dos clipes para o zoom padrão de 0.5 pixels por frame<br>**Atalho compartilhado, depende do contexto:** Sobrescrever na Agulha (Overwrite Edit) (.). |
| `Ctrl + Alt + P` | Alternar 'Seleção Acompanha a Agulha' | Ativa ou desativa a seleção automática do clipe sob a agulha ao se mover |
| `Ctrl + Alt + F` | Alternar 'Timeline Segue a Agulha' (Auto-Scroll) | Ativa ou desativa a rolagem automática da timeline para acompanhar o cursor de reprodução |
| `Shift + L` | Travar / Destravar Pista Ativa (Track Lock) | Ativa ou desativa o cadeado físico de proteção total na pista selecionada |
| `Ctrl + Alt + Shift + L` | Travar / Destravar Todas as Pistas | Alterna o cadeado físico em todas as pistas de vídeo, áudio e texto da timeline |
| `Ctrl + Shift + G` | Alternar Margens de Segurança & Guias no Player (Safe Margins) | Exibe ou oculta o overlay vetorial de Action Safe (90%), Title Safe (80%), Cruz Central e Máscaras de Proporção no Monitor de Programa |
| `Ctrl + Alt + G` | Alternar Máscara de Proporção no Player (16:9 / 9:16 / 1:1 / 2.39:1) | Alterna ciclicamente entre as máscaras de proporção de aspecto (16:9, 9:16, 1:1, 2.39:1, 4:5, 4:3, Sem Máscara) no Monitor de Programa |
| `Ctrl + Z` | Desfazer Ação (Undo) | Desfaz a última alteração realizada na timeline |
| `Ctrl + Shift + Z` ou `Ctrl + Y` | Refazer Ação (Redo) | Refaz a edição desfeita anteriormente |
| `Ctrl + Shift + S` | Salvar Preset de Workspace | Abre o diálogo para salvar o layout visual atual da interface |

#### 7. Layout & Workspace (Numpad)

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Alt + Z` | Desfazer Mudança de Layout | Desfaz a última mudança na disposição dos painéis (histórico separado do da timeline) |
| `Ctrl + Alt + Shift + Z` | Refazer Mudança de Layout | Refaz a mudança de layout desfeita anteriormente |
| `Num 1` | Timeline: Expansão Direcional Esquerda | Alterna a expansão da timeline sob a sidebar esquerda (bottom-left ↔ center) |
| `Alt + Num 1` | Timeline: Toggle Cabeçalho de Pistas | Oculta ou exibe a área de faixas e timecode da timeline (Track Headers) |
| `Num 2` | Timeline: Alternar Centro ↔ Faixa Total | Alterna a timeline entre entre menus (center) e largura total na base (bottom-full) |
| `Alt + Num 2` | Timeline: Recolher / Restaurar Verticalmente | Recolhe ou expande o painel da timeline para a linha restauradora na base |
| `Ctrl + Num 2` | Timeline: Destacar / Reanexar Janela | Abre a timeline em janela flutuante para o segundo monitor ou a reanexa |
| `Num 3` | Timeline: Expansão Direcional Direita | Alterna a expansão da timeline sob a sidebar direita (bottom-right ↔ center) |
| `Alt + Num 3` | Timeline: Toggle Barra de Ferramentas | Recolhe ou expande a barra vertical de ferramentas de corte (V, C, Trims) |
| `Num 4` | Biblioteca: Ocultar / Exibir | Recolhe ou expande a sidebar esquerda (Biblioteca de mídias, temas, rostos) |
| `Alt + Num 4` | Biblioteca: Layout Estúdio (Maximizar) | Maximiza a biblioteca no layout estúdio com timeline e players empilhados |
| `Ctrl + Num 4` | Biblioteca: Destacar / Reanexar Janela | Abre a biblioteca em janela flutuante externa ou a reanexa |
| `Num 5` | Inspetor: Ocultar / Exibir | Recolhe ou expande o painel de Ajustes & Efeitos (Inspetor) |
| `Alt + Num 5` | Inspetor: Maximizar / Restaurar | Maximiza o painel de Ajustes & Efeitos no espaço disponível |
| `Ctrl + Num 5` | Inspetor: Destacar / Reanexar Janela | Abre o Inspetor em janela flutuante externa ou o reanexa |
| `Num 6` | Painel Direito: Ocultar / Exibir | Recolhe ou expande a sidebar direita (Transcrição, Visão IA, Tarefas, Logs) |
| `Alt + Num 6` | Painel Direito: Maximizar / Restaurar | Maximiza a sidebar direita no espaço disponível |
| `Ctrl + Num 6` | Painel Direito: Destacar / Reanexar Janela | Abre a sidebar direita em janela flutuante externa ou a reanexa |
| `Num 7` | Source Player: Ocultar / Exibir | Oculta ou exibe o monitor de origem (Source Player) |
| `Alt + Num 7` | Source Player: Maximizar / Restaurar | Maximiza o monitor de origem no palco central |
| `Ctrl + Num 7` | Source Player: Destacar / Reanexar Janela | Abre o monitor de origem em janela flutuante externa ou o reanexa |
| `Num 8` | Header Geral: Ocultar / Exibir | Recolhe ou expande o cabeçalho superior da aplicação para ganhar espaço vertical |
| `Num 9` | Program Player: Ocultar / Exibir | Oculta ou exibe o monitor de programa (Program Player) |
| `Alt + Num 9` | Program Player: Maximizar / Restaurar | Maximiza o monitor de programa no palco central |
| `Ctrl + Num 9` | Program Player: Destacar / Reanexar Janela | Abre o monitor de programa em janela flutuante externa ou o reanexa |
| `Num 0` | Modo Foco / Cinema / Zen | Macro global: recolhe ou restaura Header e todas as Sidebars simultaneamente |
| `Num .` | Timeline: Toggle Cabeçalho Superior | Recolhe ou restaura a barra superior de nome, zoom e sequência da timeline |
| `Num +` | Timeline: Aumentar Altura das Pistas | Aumenta a altura das faixas de áudio e vídeo na timeline (+10px) |
| `Num -` | Timeline: Diminuir Altura das Pistas | Diminui a altura das faixas de áudio e vídeo na timeline (-10px) |
| `Num /` | Monitores: Alternar Lado a Lado / Empilhados | Alterna a disposição dos monitores entre horizontal e vertical |
| `Num *` | Monitores: Swap / Alternar Foco | Alterna o foco ativo entre o Monitor Source e o Monitor Program<br>**Atalho compartilhado, depende do contexto:** Adicionar / Editar Marcador (Num *). |
| `Num Enter` | Maximizar / Restaurar Painel sob Foco | Maximiza ou restaura o painel ativo ou sob o cursor |
| `Ctrl + Alt + 1` ou `Ctrl + Alt + Num 1` | Workspace: Carregar Slot 1 | Carrega instantaneamente o layout salvo no slot numérico 1 (Ctrl + Alt + 1) |
| `Ctrl + Alt + 2` ou `Ctrl + Alt + Num 2` | Workspace: Carregar Slot 2 | Carrega instantaneamente o layout salvo no slot numérico 2 (Ctrl + Alt + 2) |
| `Ctrl + Alt + 3` ou `Ctrl + Alt + Num 3` | Workspace: Carregar Slot 3 | Carrega instantaneamente o layout salvo no slot numérico 3 (Ctrl + Alt + 3) |
| `Ctrl + Alt + 4` ou `Ctrl + Alt + Num 4` | Workspace: Carregar Slot 4 | Carrega instantaneamente o layout salvo no slot numérico 4 (Ctrl + Alt + 4) |
| `Ctrl + Alt + 5` ou `Ctrl + Alt + Num 5` | Workspace: Carregar Slot 5 | Carrega instantaneamente o layout salvo no slot numérico 5 (Ctrl + Alt + 5) |
| `Ctrl + Alt + 6` ou `Ctrl + Alt + Num 6` | Workspace: Carregar Slot 6 | Carrega instantaneamente o layout salvo no slot numérico 6 (Ctrl + Alt + 6) |
| `Ctrl + Alt + 7` ou `Ctrl + Alt + Num 7` | Workspace: Carregar Slot 7 | Carrega instantaneamente o layout salvo no slot numérico 7 (Ctrl + Alt + 7) |
| `Ctrl + Alt + 8` ou `Ctrl + Alt + Num 8` | Workspace: Carregar Slot 8 | Carrega instantaneamente o layout salvo no slot numérico 8 (Ctrl + Alt + 8) |
| `Ctrl + Alt + 9` ou `Ctrl + Alt + Num 9` | Workspace: Carregar Slot 9 | Carrega instantaneamente o layout salvo no slot numérico 9 (Ctrl + Alt + 9) |
| `Ctrl + Alt + Shift + 1` ou `Ctrl + Alt + Shift + Num 1` | Workspace: Salvar no Slot 1 | Grava a disposição atual diretamente no slot numérico 1 (Ctrl + Alt + Shift + 1) |
| `Ctrl + Alt + Shift + 2` ou `Ctrl + Alt + Shift + Num 2` | Workspace: Salvar no Slot 2 | Grava a disposição atual diretamente no slot numérico 2 (Ctrl + Alt + Shift + 2) |
| `Ctrl + Alt + Shift + 3` ou `Ctrl + Alt + Shift + Num 3` | Workspace: Salvar no Slot 3 | Grava a disposição atual diretamente no slot numérico 3 (Ctrl + Alt + Shift + 3) |
| `Ctrl + Alt + Shift + 4` ou `Ctrl + Alt + Shift + Num 4` | Workspace: Salvar no Slot 4 | Grava a disposição atual diretamente no slot numérico 4 (Ctrl + Alt + Shift + 4) |
| `Ctrl + Alt + Shift + 5` ou `Ctrl + Alt + Shift + Num 5` | Workspace: Salvar no Slot 5 | Grava a disposição atual diretamente no slot numérico 5 (Ctrl + Alt + Shift + 5) |
| `Ctrl + Alt + Shift + 6` ou `Ctrl + Alt + Shift + Num 6` | Workspace: Salvar no Slot 6 | Grava a disposição atual diretamente no slot numérico 6 (Ctrl + Alt + Shift + 6) |
| `Ctrl + Alt + Shift + 7` ou `Ctrl + Alt + Shift + Num 7` | Workspace: Salvar no Slot 7 | Grava a disposição atual diretamente no slot numérico 7 (Ctrl + Alt + Shift + 7) |
| `Ctrl + Alt + Shift + 8` ou `Ctrl + Alt + Shift + Num 8` | Workspace: Salvar no Slot 8 | Grava a disposição atual diretamente no slot numérico 8 (Ctrl + Alt + Shift + 8) |
| `Ctrl + Alt + Shift + 9` ou `Ctrl + Alt + Shift + Num 9` | Workspace: Salvar no Slot 9 | Grava a disposição atual diretamente no slot numérico 9 (Ctrl + Alt + Shift + 9) |

<!-- GERADO:ATALHOS:FIM -->
