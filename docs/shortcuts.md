# 🎹 Cheat Sheet de Atalhos de Teclado, Perfis NLE e Manual

O **CapIAu-Talho** possui um **Sistema Central de Keymap e Perfis NLE** de alta performance, projetado para oferecer ergonomia de edição profissional tanto para quem utiliza o mapeamento nativo quanto para quem vem de outros softwares consagrados de mercado (*Kdenlive, Adobe Premiere Pro, DaVinci Resolve e Apple Final Cut Pro*).

---

## 🎛️ 1. Perfis NLE Integrados de Fábrica

Você pode alternar o perfil ativo a qualquer momento através do menu **Perfil** no cabeçalho do **Guia de Atalhos** (<kbd>⌨️</kbd> na barra de ferramentas da timeline):

| Perfil NLE | Foco & Ergonomia | Destaques de Mapeamento |
| :--- | :--- | :--- |
| 🎬 **CapIAu Padrão** | Híbrido moderno com suíte QWER/ASDF na mão esquerda para corte documental ultrarrápido. | `Q`/`W` Ripple Trims, `E`/`Z` Split, `R` / `Backspace` Ripple Delete, `Alt+R` / `Delete` Lift Delete, `A`/`S` Ponto Anterior/Seguinte, `D` Selecionar na Agulha, `Shift+D` Multi-seleção, `F` Desativar Clipe, `,` Insert, `.` Overwrite, `Ctrl+Alt+A` Canais AV/V/A, `Shift+R` / `X` Rate Stretch Tool, `Ctrl+R` Velocidade/Duração, `Ctrl+Alt+R` Fit to Gap, `Ctrl+Shift+F` Freeze Frame, `Ctrl+Alt+F` Follow Playhead, `Ctrl+G` Ir para Timecode, `Ctrl+U` Subclipe, `Ctrl+Shift+R` / `Alt+Drop` Replace Edit, `Alt+F` Match Frame, `Shift+F` Reverse Match Frame, `Ctrl+Shift+D` Crossfade de Áudio, `N`/`Shift+S` Snapping, `Shift+N` Rolling Edit, `Ctrl+Alt+P` Seleção Acompanha Agulha, `Alt+A` Alternativas IA. |
| 🐧 **Kdenlive** | Padrão clássico do ecossistema Open Source e Linux NLE. | `Shift+R` / `X` Razor Split, `Shift+R` Rate Stretch Tool, `Ctrl+R` Velocidade, `Ctrl+Shift+F` Freeze Frame, `Ctrl+G` Ir para Timecode, `Ctrl+U` Subclipe, `S` Seleção, `M` / `Shift+M` Espaçador, `V` Inserção, `Ctrl+Shift+D` Crossfade de Áudio, `F10` Snapping, `Ctrl+Shift+Espaço` Zoom to Fit, `Ctrl+=`/`Ctrl+-` Zoom, `.` Zoom Reset, `Z` Zoom Tool, `H` Mão, `Alt+F` Match Frame, `Shift+F` Reverse Match Frame, `B` Desativar Clipe, `J`/`K`/`L` Shuttle. |
| 🟣 **Adobe Premiere Pro** | Ergonomia familiar para editores acostumados ao ecossistema Adobe. | `Ctrl+K` / `C` Razor Split, `R` Rate Stretch Tool, `Ctrl+R` Velocidade/Duração, `Ctrl+Shift+F` Freeze Frame, `Ctrl+G` Ir para Timecode, `Ctrl+U` Subclipe, `Ctrl+Shift+R` Replace Edit, `A` / `Shift+A` Seleção de Trilha, `V` Seleção, `S` Snapping, `Q`/`W` Ripple Trims, `,` Insert, `.` Overwrite, `Ctrl+Shift+D` Crossfade de Áudio Padrão, `F` Match Frame, `Shift+F` Reverse Match Frame, `Shift+E` Desativar Clipe, `\` Zoom to Fit, `+`/`-` Zoom na Agulha, `Ctrl+1` Zoom Reset, `Z` Zoom Tool, `H` Mão. |
| 🟡 **DaVinci Resolve** | Padrão Blackmagic Design para ilhas de edição e pós-produção. | `Ctrl+\` / `B` Blade Split, `R` Rate Stretch Tool, `Ctrl+R` Velocidade/Duração, `Ctrl+Shift+F` Freeze Frame, `Ctrl+G` Ir para Timecode, `Ctrl+U` Subclipe, `A` Seleção, `N` Snapping, `Shift+Backspace` Ripple Delete, `Alt+[` / `Alt+]` Trims, `F9` Insert, `F10` Overwrite, `Ctrl+Shift+D` Crossfade de Áudio, `F` Match Frame, `Shift+F` Reverse Match Frame, `D` Desativar Clipe, `Shift+Z` Zoom to Fit, `Ctrl+=`/`Ctrl+-` Zoom, `Shift+1` Zoom Reset, `Z` Zoom Tool, `H` Mão. |
| 🍏 **Apple Final Cut Pro** | Ergonomia magnética e atalhos otimizados para fluxo contínuo. | `Cmd+B` / `B` Blade Split, `R` Rate Stretch Tool, `Ctrl+R` Velocidade/Duração, `Ctrl+Shift+F` Freeze Frame, `Ctrl+P` Ir para Timecode, `Ctrl+U` Subclipe, `A` Seleção, `N` Snapping, `W` Insert, `E` Append, `Shift+Delete` Ripple Delete, `Ctrl+Shift+D` Crossfade de Áudio, `Shift+F` Match Frame, `Alt+F` Reverse Match Frame, `V` Desativar Clipe, `Shift+Z` Zoom to Fit, `Cmd+=`/`Cmd+-` Zoom, `Shift+1` Zoom Reset, `Z` Zoom Tool, `H` Mão. |
| ⚙️ **Personalizado (Custom)** | Mapeamento livre configurado pelo usuário. | Totalmente editável pela aba **Personalizar Atalhos & Tabela**, com persistência local e exportação JSON. |

---

## ⌨️ 2. Teclado Visual Esquemático 1:1 & Área de Teste em Tempo Real

No modal de atalhos (<kbd>⌨️</kbd> na timeline), a aba principal **Teclado Visual & Índice Esquemático** oferece uma experiência interativa completa:

* **Abertura Direta em Tela Cheia (100% Fullscreen)**: O modal abre instantaneamente em `100vw × 100vh` sem bordas ou compressão inicial, aproveitando a resolução máxima do monitor sem necessidade de botões de maximizar.
* **Proporções Mecânicas 1:1 Calibradas (ANSI 100% com Numpad)**: Keycaps físicos com proporção geométrica balanceada entre os três blocos (Alfanumérico `flex: 15`, Navegação `flex: 3.2` e Teclado Numérico `flex: 4.2`), impedindo o achatamento ou estiramento de teclas (`PrtSc`, `ScrLk`, `Pause`, setas e numpad).
* **Cluster Numérico Físico (Numpad 100%)**: Bloco dedicado de 5 linhas × 4 colunas mapeado para comandos espaciais de layout e manipulação de pistas.
* **Destaque Bidirecional em 4 Colunas**:
  * Passar o mouse no **Teclado** ➔ Ilumina a linha correspondente nas 4 colunas esquemáticas abaixo (*A. Reprodução*, *B. Edição*, *C. Ferramentas & IA*, *D. Layout & Workspace*) e rola até ela.
  * Passar o mouse no **Índice Esquemático** ➔ Ilumina a tecla correspondente no teclado virtual.
* **Camadas de Modificadores Completas**: Alterne entre as camadas `Padrão`, `+ Shift`, `+ Ctrl`, `+ Alt` e `+ Ctrl+Alt` (ou segure os modificadores no teclado físico para alternância instantânea).
* **Live Testing HUD**: Digite qualquer tecla física com o modal aberto para testar atalhos ao vivo com feedback de iluminação neon e descrição instantânea.
* **Filtros por Categoria**: Tabela com botões pílula incluindo a nova categoria **Layout & Numpad**.

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
| **`Shift + ←` / `Shift + →`** | **Shuttle Acelerado Contínuo** | Segurar reproduz acelerado e soltar pausa; toques rápidos ciclam velocidade (2x, 4x, 8x, 16x). |
| **`Ctrl + ←` / `Ctrl + →`** | **Câmera Lenta Suave** | Reproduz em câmera lenta suave (0.25x / -0.25x), pausando imediatamente ao soltar a tecla. |
| **`←` / `→`** | **Navegar Frames** | Retrocede ou avança exatamente 1 frame do vídeo para cortes cirúrgicos. |
| **`Ctrl + G`** *(ou `Ctrl+P` no FCP)* | **Ir para Timecode / Entrada Numérica** | Ativa entrada numérica inline (.interactive-timecode) para saltos relativos (`+50`, `-24`), notação de ponto (`1.`), segundos (`+2s`) ou timecode absoluto. |
| **`A` / `S`** *(ou `↑` / `↓`)* | **Navegar Pontos de Corte (Edit Points)** | **Na Timeline:** Move a agulha para o corte anterior (`A`/↑) ou próximo (`S`/↓).<br>**No Source:** Pula para o ponto In/Início (↑) ou ponto Out/Fim (↓). |
| **`Shift + I`** | **Ir para Ponto IN** | Posiciona a agulha de reprodução exatamente no ponto de entrada marcado. |
| **`Shift + O`** | **Ir para Ponto OUT** | Posiciona a agulha de reprodução exatamente no ponto de saída marcado. |
| **`Alt + F`** *(ou `F` no Premiere/Resolve / `Shift+F` no FCP)* | **Localizar Quadro na Fonte (Match Frame)** | Localiza a mídia original do clipe sob o playhead na timeline e abre no Source Player no mesmo instante exato, projetando os marcadores [IN-OUT]. |
| **`Shift + F`** *(ou `Alt+F` no Final Cut)* | **Localizar Quadro na Timeline (Reverse Match Frame)** | Do Source Player, localiza onde o quadro atual foi utilizado na timeline ativa, salta a agulha para o corte e seleciona o clipe. Segurando `Shift` e teclando `F` sucessivamente, cicla sequencialmente por todas as ocorrências na montagem com Mini-HUD flutuante e menu popover. |
| **`Duplo Clique` (Player)** | **Maximizar / Minimizar Player** | Expande o monitor ativo para tela cheia ou restaura o layout. |
| **`Shift + Roda` (Cabeçalho de Pista)** | **Altura Individual da Pista** | Aumenta ou diminui a altura vertical daquela pista específica em passos de 8px (22px a 240px). |
| **`Shift + Roda` (Timeline / Canvas)** | **Altura Global das Pistas** | Ajusta progressivamente a escala vertical de todas as pistas da timeline. |
| **`Shift + Roda` (Biblioteca)** | **Zoom Dinâmico de Cards** | Ajusta progressivamente o tamanho dos cards e miniaturas da biblioteca. |

---

## 📥 4. Ingestão e Inserção de Mídias na Timeline (Biblioteca & Duplo Clique)

O CapIAu-Talho suporta múltiplos modos de ingestão instantânea via **combinações de teclas no duplo clique** e pelo **submenu "Adicionar à Timeline"** no menu de contexto (botão direito):

| Tecla / Combinação | Modo de Ingestão | Ação e Comportamento na Timeline | Posição da Agulha |
| :--- | :--- | :--- | :--- |
| **`Duplo Clique`** | **No Final da Timeline (Append)** | Localiza o término da timeline e anexa no final (prefere Pista 1 em empate; ignora pistas ocultas). | Final do clipe inserido |
| **`Shift + Duplo Clique`** | **Na Posição da Agulha (Playhead)** | Insere no frame exato onde a agulha está na pista ativa/padrão. | Final do clipe inserido |
| **`Ctrl + Duplo Clique`** *(ou `Cmd`)* | **No 1º Espaço Vazio (Primeiro Gap)** | Encontra o primeiro espaço vazio (gap) a partir do frame 0 e insere no início dele. | **Início do clipe inserido** |
| **`Ctrl + Shift + Duplo Clique`** | **No Próximo Espaço Vazio (Após Agulha)** | Encontra o primeiro gap à frente da agulha atual e insere no início dele. | **Início do clipe inserido** |
| **`Alt + Shift + Duplo Clique`** | **No Início da Timeline (Frame 0)** | Insere no frame 0 da pista de destino. | Início (Frame 0) |
| **`Alt + 2x Clique`** | **Inserir Empurrando (Ripple Insert)** | Divide clipes sob a agulha e empurra todos os cortes subsequentes pela duração do novo clipe. | Final do clipe inserido |
| **`Ctrl + Alt + 2x Clique`** | **Sobrepor em Pista Superior (Overlay)** | Insere na pista superior livre (ex: V2/B-Roll) na posição da agulha. | Final do clipe inserido |
| **`Ctrl + Shift + R`** *(ou `Alt + Arraste`)* | **Substituir Clipe (Replace Edit)** | Substitui a mídia do clipe atualmente selecionado na timeline mantendo rigorosamente sua duração, velocidade, cor e efeitos. | Mantém posição |
| **`Ctrl + U`** *(no Source Player)* | **Criar Subclipe Virtual** | Gera subclipe virtual não-destrutivo com hard boundaries a partir dos pontos [In–Out] com sugestões de títulos por IA. | Inalterada |
| **`R` / `Shift + R`** *(na Biblioteca/Galeria)* | **Girar Mídia 90°** | Gira a orientação da mídia em 90° no sentido horário (`R`) ou anti-horário (`Shift+R`). | Inalterada |

---

## ✂️ 5. Marcação de Pontos e Edição na Timeline

| Tecla / Combinação | Ação | Descrição |
| :--- | :--- | :--- |
| **`I`** | **Marcar Entrada (In)** | **No Source / Na Timeline:** Define o frame inicial do trecho ativo. |
| **`O`** | **Marcar Saída (Out)** | **No Source / Na Timeline:** Define o frame final do trecho ativo. |
| **`Alt + X`** | **Limpar In / Out** | Remove as marcações de entrada e saída ativas no monitor ou timeline. |
| **`,` (Vírgula)** | **Inserção Ripple / Insert (3 Pontos)** | Insere o trecho demarcado [In–Out] do Source Player na agulha da timeline, empurrando cortes subsequentes com sincronismo atômico. |
| **`.` (Ponto)** *(ou `F10`)* | **Sobrescrita / Overwrite (3 Pontos)** | Substitui o trecho da timeline a partir da agulha pela duração do trecho [In–Out] da fonte sem empurrar os clipes posteriores. |
| **`Ctrl + Alt + A`** | **Alternar Canais de Inserção (AV / V / A)** | Alterna o roteamento de canais da montagem de 3 pontos: Áudio + Vídeo (`AV`) $\rightarrow$ Apenas Vídeo (`V`) $\rightarrow$ Apenas Áudio (`A`). |
| **`Alt + F`** *(ou `F` no Premiere/Resolve / `Shift+F` no FCP)* | **Localizar Quadro na Fonte (Match Frame)** | Com a agulha sobre um clipe na timeline, abre a mídia bruta no Source Player no mesmo quadro exato e projeta marcadores [IN-OUT]. |
| **`Shift + F`** *(ou `Alt+F` no Final Cut)* | **Localizar na Timeline (Reverse Match Frame)** | Do Source Player, localiza onde o quadro atual foi utilizado na timeline ativa, salta a agulha e seleciona o clipe. Segurando `Shift` e teclando `F` sucessivamente, cicla sequencialmente por todas as ocorrências na montagem com Mini-HUD flutuante e menu popover. |
| **`;` (Ponto e Vírgula)** | **Lift (Extração com Gap)** | Remove o trecho entre [In–Out] mantendo o espaço vazio correspondente. |
| **`'` (Aspas Simples)** | **Extract (Extração com Ripple)** | Remove o trecho entre [In–Out] e fecha o espaço puxando os clipes à direita. |
| **`E`** ou **`Z`** *(ou `Ctrl+K`/`Cmd+B`)* | **Dividir Clipe no Playhead (Split)** | Corta o clipe sob a agulha instantaneamente, sem precisar selecionar previamente o clipe na timeline. Completa a tríade ergonômica da mão esquerda **`Q`** (Trim Início), **`W`** (Trim Fim) e **`E`** (Split). Divide par A/V sincronizado (`Alt+E` ou `Alt+Z` para corte individual J/L-Cut). |
| **`Shift + E`** | **Adicionar à Timeline (Append)** | Insere o trecho marcado [In–Out] do monitor de origem na trilha correspondente. |
| **`Q`** | **Ripple Trim Head** | Corta do início do clipe até a agulha e puxa os clipes posteriores nas pistas com Sync Lock. |
| **`W`** | **Ripple Trim Tail** | Corta da agulha até o fim do clipe e puxa os clipes posteriores nas pistas com Sync Lock. |
| **`R`** *(ou `Backspace`)* | **Ripple Delete Inteligente** | Apaga o clipe selecionado, gap selecionado ou sob a agulha e puxa os clipes posteriores fechando o vão. |
| **`Alt + R`** | **Lift Delete Rápido (Mão Esquerda)** | Apaga o clipe selecionado ou sob a agulha mantendo o vão vazio (gap) intacto. |
| **`Backspace`** | **Ripple Delete / Fechar Gap** | **Em clipe ou sob a agulha:** Apaga e fecha a lacuna com ripple.<br>**Em Gap:** Fecha o vão vazio puxando os clipes.<br>**Em Ghost:** Rejeita sugestão de IA. |
| **`Delete`** | **Lift Delete** | Apaga o clipe selecionado ou sob a agulha mantendo o vão vazio (Gap) intacto. |
| **`A` / `S`** | **Navegar Pontos de Corte (Edit Points)** | Salta a agulha instantaneamente para o ponto de corte anterior (`A`) ou seguinte (`S`). |
| **`D`** | **Selecionar Clipe na Agulha** | Seleciona com 1 toque o clipe sob a agulha na trilha ativa (*Select at Playhead*). |
| **`Shift + D`** | **Multi-Seleção na Agulha** | Seleciona todos os clipes sob a agulha em todas as faixas e adiciona cumulativamente à seleção atual. |
| **`F`** | **Ativar / Desativar Clipe (Mute/Bypass)** | Desativa o clipe (hachura visual, mute no áudio e bypass no export). Pressione novamente para reativar. |
| **`Ctrl + Alt + P`** | **Alternar Seleção Acompanha a Agulha** | Liga ou desliga o modo dinâmico onde o clipe que cruza a agulha é selecionado automaticamente. |
| **`Shift + Delete`** | **Ripple Delete de Clipe** | Apaga o clipe selecionado e fecha o espaço vazio imediatamente. |
| **`Alt + Delete`** | **Apagar Faixa Única** | Apaga apenas o vídeo ou o áudio do clipe selecionado, desvinculando o par temporariamente. |
| **`Alt + Clique`** | **Seleção A/V Independente** | Seleciona apenas a pista clicada de um par vinculado para cortes L-Cut e J-Cut. |
| **`Ctrl + Arraste`** | **Ripple Insert** | Insere mídia abrindo espaço e empurrando os cortes à direita nas pistas sincronizadas. |
| **`Ctrl + Trim`** | **Ripple Trim** | Ajusta as bordas de entrada/saída compensando o tempo nas pistas sincronizadas. |
| **`Ctrl + R`** | **Velocidade e Duração do Clipe** | Abre diálogo modal flutuante com cálculo bidirecional de %, timecode, opções de Ripple/Cortar e Reverse Play. |
| **`Ctrl + Alt + R`** | **Preencher Lacuna (Fit to Gap)** | Ajusta a velocidade do clipe selecionado para preencher a lacuna vizinha perfeitamente sem empurrar a montagem. |
| **`Ctrl + Shift + F`** | **Congelar Quadro (Freeze Frame)** | Congela o frame sob o playhead com técnica tail hold e imunidade a limites da mídia fonte (*bounds immunity*). |
| **`Ctrl + Alt + F`** | **Alternar Rolagem Automática (Follow Playhead)** | Ativa ou desativa a rolagem automática da timeline durante playback (modos Page e Smooth). |
| **`Ctrl + Shift + D`** | **Crossfade de Áudio com Potência Constante** | Cria crossfade equal-power no corte sob a agulha ou entre os clipes de áudio selecionados (ou fade in/out se clipe isolado). |

---

## 🎛️ 6. Ferramentas da Timeline e Ajustes de Precisão

| Tecla / Combinação | Ação | Descrição |
| :--- | :--- | :--- |
| **`V`** *(ou `S` no Kdenlive / `A` no Resolve)* | **Ferramenta de Seleção** | Retorna ao cursor padrão de seleção e arraste. |
| **`Shift + R`** *(ou `X` no CapIAu / `R` no Premiere/Resolve/FCP / `Shift+R` no Kdenlive)* | **Ferramenta Estiramento de Taxa (Rate Stretch Tool)** | Altera a velocidade arrastando as bordas do clipe na timeline (10% a 1000%), com HUD flutuante em tempo real e cursores SVG direcionais. Mantenha `Alt` para estiramento de faixa individual. |
| **`C`** *(ou `B` no Resolve/Final Cut)* | **Ferramenta Lâmina / Gilete (Blade)** | Divide o clipe clicado no frame exato (`Shift+C` fatia todas as pistas destravadas na agulha). |
| **`Y`** *(ou `Shift+Y` no Resolve)* | **Deslizar Conteúdo Interno (Slip Tool)** | Desliza os pontos IN e OUT da mídia bruta mantendo a posição e duração na timeline intactas. |
| **`U`** | **Deslocamento com Compensação (Slide Tool)** | Move a posição do clipe compensando simetricamente nos vizinhos adjacentes. |
| **`Shift + N`** *(ou `T` no Resolve/Final Cut)* | **Corte Contínuo Adjacente (Rolling Edit)** | Ajusta o ponto de corte entre dois clipes contíguos sem alterar a duração total da sequência. |
| **`Arraste Livre`** | **Seleção por Retângulo (Marquee)** | Abre caixa pontilhada para selecionar múltiplos clipes e marcadores em bloco. |
| **`T`** *(ou `A` no Premiere)* | **Selecionar Faixa para Frente** | Seleciona todos os clipes à direita em todas as faixas ativas (*Shift = 1 faixa*). |
| **`Shift + T`** *(ou `Shift+A`)* | **Selecionar Faixa para Trás** | Seleciona todos os clipes à esquerda em todas as faixas ativas (*Shift = 1 faixa*). |
| **`N`** *(ou `Shift+S` / `F10`)* | **Alternar Snapping Magnético** | Liga ou desliga o magnetismo da timeline com guias visuais no Canvas. |
| **`H`** *(ou segurar `Espaço` / botão do meio)* | **Ferramenta Mão / Pan** | Permite arrastar e navegar livremente pela timeline em qualquer direção. |
| **`Z`** *(ou ícone na barra de ferramentas)* | **Ferramenta Zoom / Lupa** | Clique com botão esquerdo para aproximar (1.4x), `Alt + Clique` para afastar (0.7x), centrado no clique. *(Nos perfis Premiere/Resolve/FCP/Kdenlive, atalho nativo `Z`)*. |
| **`+` / `=`** *(ou `Ctrl+=` no Resolve/FCP/Kdenlive)* | **Aumentar Zoom na Timeline (Zoom In)** | Aproxima o zoom horizontal da régua e clipes ancorado na posição da agulha de reprodução (*Playhead*). |
| **`-`** *(ou `Ctrl+-` no Resolve/FCP/Kdenlive)* | **Diminuir Zoom na Timeline (Zoom Out)** | Afasta o zoom horizontal da régua e clipes ancorado na posição da agulha de reprodução (*Playhead*). |
| **`\`** *(ou `Shift+Z` / `Ctrl+Shift+Espaço`)* | **Ajustar Sequência na Tela (Zoom to Fit)** | Alternância (*Toggle*) inteligente: enquadra perfeitamente todos os clipes na timeline com margem de respiro ou restaura o zoom anterior. |
| **`.` (Ponto)** *(ou `Ctrl+1` no Premiere / `Shift+1` no Resolve/FCP)* | **Restaurar Zoom Padrão (1:1 / 0.5 px/f)** | Redefine a escala horizontal para 0.5 pixels por frame. |
| **`Roda do Mouse` (sobre a Régua)** | **Zoom Horizontal Dinâmico na Régua** | Rolar a roda do mouse diretamente sobre a régua aplica zoom horizontal contínuo centralizado no ponteiro. |
| **`Ctrl + Roda` (sobre o Canvas)** | **Zoom Horizontal Centralizado no Cursor** | Aproxima ou afasta a timeline centrado na coordenada do ponteiro do mouse. |
| **`Shift + Roda` (sobre Cabeçalho de Pista)** | **Altura Individual daquela Pista Específica** | Aumenta ou diminui a altura vertical daquela pista específica em passos de 8px (22px a 240px). |
| **`Shift + Roda` (sobre o Canvas / Régua)** | **Altura Global de Todas as Pistas** | Ajusta progressivamente a escala vertical uniforme de todas as faixas (0.5x a 1.7x). |
| **`←` / `→`** | **Deslocar Clipe (Nudge 1 Frame)** | Desloca o clipe selecionado 1 frame para a esquerda ou direita. |
| **`Alt + ←` / `Alt + →`** | **Ajustar Ponto IN (Trim In)** | Recua ou avança a borda esquerda do clipe selecionado em 1 frame. |
| **`Shift + ←` / `Shift + →`** | **Ajustar Ponto OUT (Trim Out)** | Recua ou avança a borda direita do clipe selecionado em 1 frame. |
| **`[` / `]`** | **Nudge Trim Rápido** | Ajusta borda esquerda (`[`) ou borda direita (`]`) em 1 frame. |

---

## 📍 7. Marcadores de Timeline e Clipe

| Tecla / Combinação | Ação | Descrição |
| :--- | :--- | :--- |
| **`M`** | **Adicionar / Editar Marcador** | Cria ou edita marcador na agulha sem pausar a reprodução. |
| **`Shift + M`** | **Pular para Próximo Marcador** | Move a agulha para o próximo marcador da timeline. |
| **`Alt + M`** | **Pular para Marcador Anterior** | Move a agulha para o marcador anterior da timeline. |
| **`Shift + Clique`** | **Seleção Múltipla de Marcadores** | Seleciona vários marcadores simultaneamente para edição ou exclusão em lote. |
| **`Tab` (no box do marcador)** | **Alternar Campos** | Navega entre Título, Comentário e Seletor de Cores. |
| **`Enter` / `Esc`** | **Salvar e Fechar Marcador** | Salva e fecha o popover de marcador instantaneamente. |

---

## 🤖 8. Inteligência Artificial, Inspetor e Comandos Globais

| Tecla / Combinação | Ação | Descrição |
| :--- | :--- | :--- |
| **`Alt + A`** *(ou `A` na Biblioteca)* | **Alternativas IA / Inspetor** | **Na Timeline:** Abre o carrossel de planos alternativos sugeridos pela IA.<br>**Na Biblioteca:** Abre o Inspetor de Metadados e Decupagem. |
| **`Enter` / `Y`** | **Aceitar Sugestão de IA** | Aceita e consolida o clipe fantasma (*ghost clip*) sugerido na timeline. |
| **`Del` (sobre Ghost)** | **Rejeitar Sugestão de IA** | Remove o clipe fantasma sugerido pela IA. |
| **`Ctrl + S`** | **Salvar Timeline / Projeto** | Salva a timeline ativa e persiste no banco SQLite/JSON. |
| **`Ctrl + Z`** | **Desfazer (Undo)** | Desfaz a última ação realizada na timeline. |
| **`Ctrl + Y`** *(ou `Ctrl+Shift+Z`)* | **Refazer (Redo)** | Refaz a ação desfeita. |
| **`Esc`** | **Fechar / Cancelar** | Fecha modais, limpa seleções e conclui edições de texto. |

---

## 🎹 9. Atalhos Espaciais do Teclado Numérico (Numpad)

O teclado numérico físico espelha intuitivamente a geometria dos painéis e quadrantes da workspace do CapIAu:

| Tecla / Combinação | Ação NLE | Descrição do Comportamento |
| :--- | :--- | :--- |
| **`Numpad 1`** | **Timeline: Expandir Esquerda** | Alterna expansão da timeline sob a biblioteca (`bottom-left` $\leftrightarrow$ `center`). |
| **`Alt + Numpad 1`** | **Timeline: Cabeçalhos de Pistas** | Alterna visibilidade dos cabeçalhos das trilhas (*Track Headers* / controles de Mute, Lock, Magnet). |
| **`Numpad 2`** | **Timeline: Faixa de Baixo Completa** | Alterna timeline em largura total de rodapé (`bottom-full` $\leftrightarrow$ `center`). |
| **`Alt + Numpad 2`** | **Timeline: Régua de Tempo** | Alterna visibilidade da régua de tempo (*Ruler*) e marcadores de tempo da timeline. |
| **`Ctrl + Numpad 2`** | **Timeline: Destacar / Popout** | Destaca a timeline para uma janela externa independente (ou reanexa). |
| **`Numpad 3`** | **Timeline: Expandir Direita** | Alterna expansão da timeline sob o painel direito (`bottom-right` $\leftrightarrow$ `center`). |
| **`Alt + Numpad 3`** | **Timeline: Minimapa** | Alterna visibilidade do minimapa de navegação panorâmica da timeline. |
| **`Numpad 4`** | **Biblioteca: Ocultar / Mostrar** | Recolhe ou restaura a barra lateral esquerda da biblioteca de mídias. |
| **`Alt + Numpad 4`** | **Biblioteca: Modo Estúdio** | Maximiza a biblioteca com monitores empilhados e visualização ampla de arquivos. |
| **`Ctrl + Numpad 4`** | **Biblioteca: Destacar / Popout** | Destaca a biblioteca para monitor secundário (ou reanexa). |
| **`Numpad 5`** | **Reanexar Janelas Destacadas** | Reanexa todas as janelas externas (popouts) de volta ao editor principal. |
| **`Alt + Numpad 5`** | **Inspetor: Maximizar / Restaurar** | Maximiza ou restaura a largura horizontal do painel de ajustes e efeitos. |
| **`Ctrl + Numpad 5`** | **Inspetor: Destacar / Popout** | Destaca o inspetor para monitor secundário (ou reanexa). |
| **`Numpad 6`** | **Painel Direito: Ocultar / Mostrar** | Recolhe ou restaura a barra lateral direita de transcrição, IA e ferramentas. |
| **`Alt + Numpad 6`** | **Painel Direito: Maximizar** | Maximiza ou restaura a largura horizontal do painel lateral direito. |
| **`Ctrl + Numpad 6`** | **Painel Direito: Destacar / Popout** | Destaca o painel direito para monitor secundário (ou reanexa). |
| **`Numpad 7`** | **Header Superior: Ocultar / Mostrar** | Recolhe ou restaura a barra de menu e ferramentas globais do topo. |
| **`Alt + Numpad 7`** | **Source Player: Maximizar** | Expande o monitor Source para o tamanho máximo do contêiner. |
| **`Ctrl + Numpad 7`** | **Source Player: Destacar / Popout** | Destaca o monitor Source para janela externa (ou reanexa). |
| **`Numpad 8`** | **Barra de Ferramentas: Ocultar / Mostrar** | Recolhe ou restaura a barra de ferramentas da timeline (*Toolbar*). |
| **`Numpad 9`** | **Monitores: Alternar Visualização** | Cicla a exibição dos monitores: *Source* $\rightarrow$ *Program* $\rightarrow$ *Ambos*. |
| **`Alt + Numpad 9`** | **Program Player: Maximizar** | Expande o monitor Program para o tamanho máximo do contêiner. |
| **`Ctrl + Numpad 9`** | **Program Player: Destacar / Popout** | Destaca o monitor Program para janela externa (ou reanexa). |
| **`Numpad 0`** | **Modo Zen / Cinema** | Macro de 1 toque: oculta cabeçalho e todas as sidebars; 2º toque restaura o estado exato anterior. |
| **`Numpad .`** | **Timeline: Barra Superior** | Recolhe ou restaura a barra com timecode, sliders de zoom e opções de pista. |
| **`Alt + Numpad .`** | **Timeline: Barra de Status** | Recolhe ou restaura a barra inferior de status da timeline. |
| **`Numpad +`** | **Aumentar Altura das Trilhas** | Incrementa a escala vertical das faixas da timeline (+8px). |
| **`Numpad -`** | **Diminuir Altura das Trilhas** | Decrementa a escala vertical das faixas da timeline (-8px). |
| **`Numpad /`** | **Monitores: Disposição** | Alterna entre layout Lado a Lado (`side-by-side`) e Empilhados (`stacked`). |
| **`Numpad *`** | **Monitores: Swap / Trocar Foco** | Alterna o foco ativo ou inverte a posição/maximização entre Source e Program. |
| **`Numpad Enter`** | **Maximizar Painel Ativo** | Maximiza o painel focado ou sob o cursor do mouse na área do editor. |

---

## 🗂️ 10. Slots Numéricos Rápidos de Workspace (1 a 9)

O CapIAu permite salvar layouts completos da workspace vinculados a posições numéricas rápidas de `1` a `9`:

| Tecla / Combinação | Ação | Descrição |
| :--- | :--- | :--- |
| **`Ctrl + Alt + [1-9]`** | **Carregar Slot Numérico** | Carrega instantaneamente o layout de workspace vinculado ao slot numérico (1 a 9). |
| **`Ctrl + Alt + Shift + [1-9]`** | **Salvar Layout no Slot** | Salva e vincula a disposição exata atual de painéis, larguras e monitores ao slot correspondente (1 a 9). |

---

## 🛡️ Prevenção Inteligente de Conflitos de Digitação

O sistema monitora automaticamente o foco de digitação:
* Ao focar em caixas de texto (Chatbot de IA, busca semântica, renomeação de mídias, edição de legendas/GCs), **todos os atalhos de playback e timeline são temporariamente suspensos**.
* Ao pressionar `Esc` ou clicar fora do campo, os atalhos de edição NLE são reativados instantaneamente.
