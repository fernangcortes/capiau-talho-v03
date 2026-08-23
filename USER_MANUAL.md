# Manual do Usuário --- CapIAu-Talho Making Of Editor

Bem-vindo ao **CapIAu-Talho Making Of Editor**! Este guia prático
descreve o passo a passo de como importar suas mídias, transcrever
depoimentos, mapear imagens semanticamente, interagir com o agente de
edição e realizar a pré-edição do seu documentário de forma
profissional.

---

## 📑 Índice do Manual

1. [📂 1. Estrutura de Pastas e Organização das Mídias](#1-estrutura-de-pastas-e-organização-das-mídias)
2. [🎬 2. Fluxo de Trabalho Passo a Passo](#2-fluxo-de-trabalho-passo-a-passo)
   - [Passo A: Ingestão de Mídias](#passo-a-ingestão-de-mídias)
   - [Passo B: Transcrição (ASR), Diarização e Waveform](#passo-b-transcrição-asr-e-diarização-de-entrevistas)
   - [Passo C: Decupagem Visual de B-Rolls e Fotos (CLIP Local)](#passo-c-decupagem-visual-de-b-rolls-e-fotos)
   - [Passo D: Agrupamento em Temas (Clustering)](#passo-d-agrupamento-em-temas-clustering)
   - [Passo E: Busca Semântica Híbrida e Playlist](#passo-e-busca-semântica-híbrida-e-controles-de-playlist)
3. [🤖 3. Assistente Conversacional de Edição (Chat-Agente) & Ghost Clips](#3-assistente-conversacional-de-edição-chat-agente--ghost-clips)
4. [👥 4. Mapeamento de Rostos, Objetos e Desambiguação Rápida](#4-mapeamento-de-rostos-objetos-e-desambiguação-rápida)
5. [🎛️ 5. Pistas de Áudio Reais, J/L-Cuts e Marcadores de Timeline](#5-pistas-de-áudio-reais-e-jl-cuts-nativos)
6. [🎚️ 6. Tratamento de Áudio: Diagnóstico, Presets e Comparação A/B](#6-tratamento-de-áudio-diagnóstico-presets-e-comparação-ab)
7. [🔄 7. Carrossel de Alternativas da IA (Atalho A)](#7-carrossel-de-alternativas-da-ia-atalho-a)
8. [💾 8. Salvando, Auto-Salvamento & Logs com IA](#8-salvando-auto-salvamento--logs-com-ia)
9. [🖥️ 9. Layout e Organização Avançada (Inspetor de Mídia, Players e Estúdio)](#9-layout-e-organização-avançada)
10. [⚙️ 10. Configurações da Sequência, Auto-Configuração e Zoom do Preview](#10-configurações-da-sequência-auto-configuração-e-zoom-do-preview)
11. [📐 11. Viewport Estável, Alças de Transformação e Recorte (Crop)](#11-viewport-estável-alças-de-transformação-e-recorte-crop)
12. [🤖 12. Resiliência de IA, Seleção de Modelos e Gestão de Tarefas](#12-resiliência-de-ia-seleção-de-modelos-e-gestão-de-tarefas)
13. [🖥️ 13. Execução Resiliente sem Janela de Console no Windows](#13-execução-resiliente-sem-janela-de-console-no-windows)
14. [⚡ 14. Configurações de Hardware, Aceleração por GPU e Fallback Automático](#14-configurações-de-hardware-aceleração-por-gpu-e-fallback-automático)
15. [🎹 15. Mapa de Atalhos de Teclado NLE](#15-mapa-de-atalhos-de-teclado-nle)

---

## 📂 1. Estrutura de Pastas e Organização das Mídias

Para processar seu material de forma limpa, o CapIAu-Talho utiliza a
seguinte estrutura local criada no seu computador:

- **watch/:** A porta de entrada do sistema. Qualquer mídia (vídeo,
  áudio ou foto) colocada aqui será identificada para processamento.

- **data/originals/:** Armazena as mídias originais copiadas de forma
  segura pelo sistema.

- **data/proxies/:** Onde ficam os proxies leves em 720p/360p gerados
  automaticamente para reprodução suave no player Web.

- **data/exports/:** Onde são gravados seus arquivos finais de edição
  (XML, EDL, OTIO).

### Regra de Ouro para Nomenclatura de Arquivos:

Para ajudar a IA a identificar seus clipes de forma inteligente na
ingestão:

- Arquivos que contenham depoimentos falados de equipe/elenco devem ter
  **entrevista** ou **depoimento** no nome (ex:
  entrevista_diretor_lentes.mp4). Eles serão categorizados como
  **Entrevistas (ASR)**.

- Cliques de bastidores ou set devem ter outros nomes (ex:
  set_bastidores_vfx_take1.mp4). Eles serão catalogados como
  **Bastidores (B-Roll)**.

## 🎬 2. Fluxo de Trabalho Passo a Passo

### Passo A: Ingestão de Mídias

1.  Copie alguns vídeos de entrevistas, B-rolls ou fotos do set para a
    pasta watch/.

2.  No cabeçalho do Dashboard Web, clique no botão **Escanear watch/**.

3.  O FastAPI lerá a pasta, calculará o hash de segurança (evitando
    duplicatas), extrairá os metadados via FFprobe e iniciará a
    compressão do proxy H.264 em background no seu processador i7.

4.  As mídias aparecerão na barra lateral esquerda nas abas **Vídeos** e
    **Fotos**.

### Passo B: Transcrição (ASR) e Diarização de Entrevistas

1.  Na aba **Vídeos**, clique em uma entrevista carregada (ela começará
    a tocar no player).

2.  No menu lateral direito, clique no botão **Transcrever Vídeo
    Atual**.

3.  A API AssemblyAI fará o processamento na nuvem em segundos (usando
    seu Free Tier).

4.  O diálogo completo aparecerá no painel direito, dividido por
    falantes (ex: *Speaker A, Speaker B*) com timestamps atômicos.

5.  **Dica de ouro:** Clique em qualquer palavra ou frase do texto e o
    player de vídeo pulará exatamente para aquele segundo da fala!

6.  **Assistente de Diarização:** A transcrição agora conta com um
    assistente robusto para corrigir falantes. Na lateral direita
    superior da transcrição, você verá a \"Gaveta de Pistas\" que aponta
    possíveis erros da inteligência artificial (como falas muito longas
    com silêncio no meio, ou um rosto diferente falando).

7.  **Inspetor de Balão (Waveform):** Clique com o botão direito sobre o
    nome de qualquer falante em um balão de transcrição. Uma gaveta
    lateral se abrirá exibindo o **Inspetor de Fala**, com uma *waveform
    interativa*. Com ela você pode:

    - **Dividir falas:** Dê um clique duplo em qualquer ponto da onda de
      áudio (waveform) para dividir a fala naquele exato milissegundo. O
      player navegará direto para o trecho.

    - **Atribuição Rápida de Rosto:** O inspetor detecta quem está
      aparecendo no vídeo naquele trecho e já sugere o nome da pessoa em
      um menu suspenso para você corrigir o falante com 1 clique.

### Passo C: Decupagem Visual de B-Rolls e Fotos

1.  Os vídeos de B-roll não usam mais um relógio fixo de frames: o
    sistema primeiro **segmenta o vídeo em cortes reais** (shots) e
    subdivide planos-sequência longos em *beats* por mudança de
    conteúdo visual, classificando também o movimento de câmera
    (estático, pan, tilt, caminhando, mão livre). Um keyframe
    representativo de cada segmento é extraído e enviado para o Gemini
    2.5 Flash no OpenRouter — isso reduz o número de chamadas de IA e
    faz cada resultado de busca abrir exatamente o trecho do corte, não
    um recorte de tempo arbitrário.

2.  A IA gera descrições narrativas de bastidores e cria tags visuais
    automáticas (ex: câmera, luz, dolly).

3.  Para as fotos de set, o mesmo acontece: elas são analisadas
    visualmente e catalogadas na aba **Fotos** com descrições ricas.

4.  **Busca Visual e "Encontrar Similares" (CLIP local, sem custo de
    API):** todo keyframe de vídeo e foto é também embedado localmente
    por um modelo CLIP multilíngue. Isso habilita duas coisas: buscar por
    conceito puramente visual mesmo sem palavra correspondente na
    descrição (ex: *"contraluz na janela"*), e o botão **Encontrar
    Similares** — disponível no hover dos cards de foto, no rodapé do
    visualizador (lightbox) e na aba **IA** do Inspetor de Mídia (usa o
    frame atual do player como referência) — que retorna instantaneamente
    as mídias visualmente mais parecidas no painel de busca à direita.

### Passo D: Agrupamento em Temas (Clustering)

1.  Após transcrever suas entrevistas principais, clique no botão
    **Agrupamento Temático** (ou *Agrupar Temas*) no cabeçalho.

2.  O DeepSeek V3 lerá as transcrições das entrevistas e proporá de 5 a
    10 temas estruturados sobre o making of (ex: *Lentes Anamórficas,
    Fotografia, Roteiro*).

3.  Esses temas aparecerão na aba **Temas** na barra lateral esquerda,
    facilitando a navegação temática.

### Passo E: Busca Semântica Híbrida e Controles de Playlist

No campo de busca no topo, pesquise por conceitos (ex: *\"diretor
falando sobre iluminação\"* ou *\"câmeras no set\"*). O Qdrant embutido
na sua CPU fará uma busca vetorial instantânea e retornará falas de
entrevistas, frames de B-roll ou fotos de set correspondentes no painel
direito. Clicar no resultado abre a mídia correspondente.

- **Agrupamento & Ocorrências Secundárias:** Os resultados são
  desduplicados por arquivo de mídia. Trechos e falas secundárias
  adicionais do mesmo vídeo são agrupados em uma seção sanfonada abaixo
  do card principal. Clique em *\"Ver mais ocorrências (X)\"* para
  expandir os sub-cards correspondentes.

- **Pre-visualização Rápida (Hover Previews):** Posicione o cursor do
  mouse sobre qualquer card ou sub-card de resultado da busca. Após
  400ms, um popover lateral surgirá mostrando um preview em loop mudo de
  5 segundos do trecho exato (para vídeos) ou a imagem da foto.

- **Playlist de Busca e Autoplay Sequencial:** Uma barra de controle de
  playlist com botões de Retroceder (⏮), Autoplay (Play / Parar) e
  Avançar (⏭) é injetada no topo do feed de resultados.

  - Ao clicar em um card ou sub-card, ele é selecionado e destacado com
    uma borda brilhante e a playlist é ativada.

  - Ative o **Autoplay** clicando no botão correspondente. Os vídeos
    tocarão nos timestamps corretos e pularão automaticamente para o
    próximo resultado. No modo Autoplay, as fotos são exibidas
    diretamente dentro da área do player de vídeo por 4 segundos antes
    de avançar, sem abrir popups ou modais.

  - **Opção de Exibição de Fotos no Player:** Caso queira que o clique
    manual em fotos abra diretamente no player de vídeo em vez do
    Lightbox tradicional, marque a opção \"Abrir fotos no player de
    vídeo\" (disponível na aba de fotos da biblioteca à esquerda e na
    barra de opções de busca à direita). Ambas as caixas de seleção
    permanecem sincronizadas.

- **Busca por Similaridade em Lote (Batch Similarity):** Você pode selecionar múltiplos cards de mídias ou fotos na biblioteca e disparar a busca por similaridade visual em lote. O sistema processará os embeddings dos arquivos selecionados em paralelo no Qdrant local, listando todas as mídias visualmente congruentes no acervo.

- **Explicações Didáticas do RAG:** Nos resultados da busca RAG ou recomendações da IA, o sistema exibe uma breve justificativa explicando *por que* aquele corte ou depoimento foi selecionado como relevante para o termo pesquisado.

- **Filtro por Ciclo de Status (Status Cycle Filter):** Na barra de ferramentas da biblioteca, o botão de filtro de status permite alternar ciclicamente com cliques simples entre a exibição de *Todos os Arquivos*, *Apenas Analisados (IA)*, *Não Analisados (Pendentes)* e *Arquivos com Erro*, facilitando a auditagem rápida do acervo.

## 🤖 3. Assistente Conversacional de Edição (Chat-Agente) & Ghost Clips

O painel de Chat agora funciona como um **Agente Editor Ativo** que pode
realizar modificações físicas na sua timeline a partir de ordens
textuais simples (ex: *\"insira o clipe 2 na pista V1\"*, *\"aplique um
fade de 1s no primeiro clipe\"*, *\"cubra o depoimento do diretor com
B-rolls do set\"*).

- **Modo Direto vs. Modo Rascunho (Ghost Clips):**

  - Edições pontuais e não-destrutivas (como inserir ou ajustar um único
    clipe) são aplicadas **diretamente na timeline** (e podem ser
    desfeitas com Ctrl+Z).

  - Edições em massa ou destrutivas (como substituições amplas ou rough
    cuts automáticos) são exibidas na timeline como **clipes fantasmas
    (ghost clips)** hachurados em verde (para inserções/substituições)
    ou vermelho (para remoções).

- **Ações sobre Ghost Clips:**

  - Para **aceitar** uma sugestão e torná-la definitiva: selecione o
    clipe fantasma na timeline e pressione **Enter** (ou a tecla **Y**,
    ou clique no botão ✓ do popup correspondente).

  - Para **rejeitar** e descartar a sugestão: selecione o clipe fantasma
    e pressione **Delete** (ou **Backspace**, ou clique no botão ✗ do
    popup correspondente).

### 🎚️ O agente também entende de áudio

Quando você pergunta sobre som, ele deixa de ser montador e vira técnico de
áudio — mas continua montador no resto da conversa. A diferença em relação a um
assistente genérico é que ele **mede antes de opinar**, em vez de responder por
impressão.

O que dá para pedir:

- *"esse clipe está estourado?"* — ele roda a análise e responde com os números
  medidos, não com um palpite.
- *"o que você faria com esse áudio?"* — diz qual preset resolve, quanto custa
  em tempo e o que aquele preset **não** resolve.
- *"aplica aí"* — trata uma prévia de 15 s, não o clipe inteiro.
- *"tira o chiado desse trecho"* — mexe nos ajustes ao vivo (EQ, gate,
  compressor), que são reversíveis e não geram arquivo.

Três coisas ele **não** faz sozinho, de propósito:

1. **Não compromete um render longo** por iniciativa própria. Prévia de 15 s é o
   padrão; para tratar o clipe inteiro ele pede a sua confirmação.
2. **Não aciona o Auphonic.** Gastaria a sua cota mensal. Se o material pedir
   nuvem, ele recomenda e explica — quem aperta o botão é você.
3. **Não liga corte automático** de silêncio ou de hesitação. É a regra do
   documentário, e não vira negociável só porque quem pediu foi a IA.

## 👥 4. Mapeamento de Rostos, Objetos e Desambiguação Rápida

O CapIAu-Talho conta com uma interface completa de decupagem visual para
gerenciar as marcações de pessoas e elementos do set de filmagem.

### A. Exibição e Desenho Livre (Drag-and-Draw) no Player

- **Visualização Inteligente:** As caixas delimitadoras de rostos e
  objetos (face-box) ficam ocultas por padrão no player para não poluir
  a visualização. Elas aparecem instantaneamente ao passar o mouse perto
  do rosto ou objeto quando o player estiver **pausado**.

- **Desenhar novas caixas:** Se quiser cadastrar um objeto do cenário
  (ex: Abajur, Microfone de Lapela) ou uma pessoa não detectada
  automaticamente:

  1.  Pause o vídeo no frame desejado.

  2.  Clique com o botão esquerdo e arraste o mouse sobre o objeto para
      desenhar um retângulo pontilhado roxo.

  3.  Ao soltar, uma janela de prompt surgirá. Digite o nome do objeto
      ou pessoa (ou escolha um nome sugerido na lista) e confirme.

  4.  O retângulo se fixará na tela e atualizará automaticamente as tags
      na aba **Visão IA**.

### B. Desambiguação Rápida em Tela Cheia

Na aba **Grupos de Rostos**, clique em **Desambiguação Rápida** para
abrir o gerenciador em tela cheia. Aqui, você verá todas as detecções
ainda sem nome ou não validadas do seu projeto:

- **Preview de Contexto Instantâneo (Hover):** Algumas miniaturas podem
  estar desfocadas ou muito aproximadas. Para ver o contexto original
  completo, basta **deixar o mouse posicionado em cima do card**. O
  sistema carregará instantaneamente um popover flutuante com a foto
  original completa ou um trecho de vídeo de 5 segundos rodando em loop
  ao redor daquele frame.

- **Marcar como Objeto ou Rejeitar (Não Relevante):**

  - Clique no ícone de banir (vermelho) no canto do card.

  - Um prompt perguntará se o elemento é um objeto relevante do cenário.
    Se for (ex: Câmera), digite o nome do objeto. Se for apenas ruído
    visual, deixe em branco e confirme. O elemento será rotulado como
    Não Relevante e ignorado pelas descrições do RAG.

<!-- -->

- **Seleção em Massa (Bulk Actions):**

  - Selecione múltiplos cards clicando neles.

  - Na barra de ações inferior, digite um nome e clique em **Aplicar**
    para nomear todos ao mesmo tempo. Se o nome já pertencer a outro
    grupo, o sistema mesclará os grupos em background.

  - Clique em **Descartar** para rejeitar todas as marcações
    selecionadas de uma vez.

## 🎛️ 5. Pistas de Áudio Reais e J/L-Cuts Nativos

O CapIAu-Talho suporta trilhas de áudio independentes (A1, A2\...)
vinculadas aos clipes de vídeo (V1, V2\...).

- **Vínculo de Clipes (Link A/V):** Por padrão, os clipes de vídeo e
  seus respectivos áudios são importados de forma acoplada (link_id). Ao
  arrastar o vídeo na timeline, o áudio correspondente o acompanha de
  forma sincronizada.

- **Edição de J-Cuts e L-Cuts (Trims Independentes):**

  - Para desvincular o par de áudio e vídeo e fazer edições
    independentes (por exemplo, estender o áudio de uma fala sobre a
    cena do B-roll seguinte, ou fazer o áudio do B-roll entrar 1s antes
    do corte do vídeo), selecione o clipe e pressione a tecla **U**
    (Desvincular).

  - Após desvincular, você pode mover ou ajustar as bordas (*trim*) de
    cada faixa de forma independente na timeline.

  - O player do programa interpretará a sobreposição, reproduzindo o
    vídeo de uma faixa e o áudio da outra simultaneamente em tempo real.

- **Dividir Clipe (Split - Tecla Z):**

  - Selecione qualquer clipe na timeline e pressione a tecla **Z** para
    cortá-lo ao meio exatamente na posição da agulha (playhead).

  - Se o clipe de vídeo possuir um clipe de áudio vinculado (link_id), o
    corte é aplicado a ambos os clipes de forma sincronizada, mantendo
    as metades resultantes vinculadas individualmente.

- **Controles Nativos de Pistas (Mute, Solo e Visibilidade):**
  Cada cabeçalho de pista na timeline (V1/V2 para vídeos e A1/A2 para áudios) possui botões individuais de controle:
  - **Mute (M):** Silencia o áudio da pista correspondente.
  - **Solo (S):** Isola a pista ativa, silenciando/ocultando temporariamente todas as demais.
  - **Visibilidade (Ícone de Olho):** Oculta a renderização de vídeo da pista selecionada no Program Player.

- **Marcadores de Timeline & Clipe de Vídeo (Teclado-First, Popover Compacto & Seleção em Lote):**
  O sistema suporta dois tipos de marcadores visuais altamente integrados com a timeline:
  - **Marcadores de Régua:** Ancorados à régua de tempo para notações globais de estrutura.
  - **Marcadores Vinculados ao Clipe de Vídeo:** Se a agulha estiver sobre um clipe de vídeo na timeline (seja na pista V1 ou na pista B-Roll V2), o marcador é automaticamente fixado no retângulo do clipe de vídeo (`clipId`). Se o clipe for arrastado ou se a timeline for alterada, o marcador acompanha o vídeo perfeitamente. O marcador de clipe é desenhado exclusivamente dentro da pista do vídeo (sem stems verticais cruzando a tela).
  - **Box de Edição Flutuante Compacto:** Pressionar a tecla **M** abre um cartão compacto de 310px no canto inferior direito da tela. O vídeo **continua reproduzindo sem pausa** enquanto o editor digita.
  - **Fluxo Ultra-Rápido via Teclado:**
    - Digite o nome do marcador.
    - Pressione **Tab** para navegar para a Descrição.
    - Pressione **Tab** para selecionar a Cor.
    - Pressione **Enter** ou **Esc** para salvar e fechar o box.
    - Pressione **M** novamente para salvar o atual e abrir o marcador no novo ponto da agulha.
  - **Seleção Múltipla & Exclusão em Lote:** Segure **Shift + Clique** sobre múltiplos marcadores para selecioná-los (destacados com uma borda brilhante branca). Pressione a tecla **Delete** (ou **Backspace**) para excluir todos os marcadores selecionados de uma só vez.
  - **Navegação Rápida entre Marcadores:** Pressione **Shift + M** para saltar para o próximo marcador ou **Alt + M** para retroceder ao marcador anterior.

## 🎚️ 6. Tratamento de Áudio: Diagnóstico, Presets e Comparação A/B

Editar vídeo e editar áudio são ofícios diferentes. Esta seção existe para você
não precisar do segundo: o programa **mede** o áudio do clipe e diz o que fazer,
em vez de esperar que você reconheça o problema de ouvido.

### A. As duas naturezas de ajuste (entenda antes de mexer)

O painel **Ajustes** separa duas coisas que se comportam de formas opostas:

- **Ao vivo** — Equalizador e Dinâmica. Muda na hora, enquanto o clipe toca, e
  você desfaz quando quiser. **Não gera arquivo nenhum.** É o lugar de
  experimentar.
- **Renderizado** — a seção Tratamento. Gera um arquivo novo, demora, e entra
  numa fila. O arquivo derivado fica em
  `data/audio_tratado/{id_do_video}/{hash}.wav`; o nome é um código de 64
  caracteres porque é ele que evita reprocessar quando você reaplica a mesma
  receita. **O seu arquivo original nunca é tocado** — o clipe só passa a
  apontar para o tratado.

### B. Passo 1: diagnosticar

1. Clique num clipe de áudio na timeline (ou num vídeo com áudio vinculado).
2. Na seção **Diagnóstico de Áudio**, clique em **Analisar**. Leva ~3 segundos
   num clipe de um minuto.
3. Leia as cinco linhas. Cada uma vem com um selo: **verde** está bom, **âmbar**
   pede atenção, **vermelho** é problema sério.

| Linha | O que quer dizer | Quando incomoda |
|---|---|---|
| Loudness | volume médio do trecho | longe do alvo −16 LUFS, o clipe soa mais alto ou mais baixo que os vizinhos |
| Pico real | o instante mais alto | acima de 0 dBTP é distorção; baixar o volume depois não desfaz |
| Clipping | fração de amostras no talo | quase nunca acende neste acervo; confie no Pico real |
| Ruído | som de fundo entre as falas | acima de −35 dB o chiado aparece na montagem |
| Dinâmica | diferença entre o alto e o baixo | LRA abaixo de 5 já está esmagado: **não comprima de novo** |

4. Se houver o ícone **(i)** ao lado de uma linha, clique nele: abre uma
   explicação detalhada com um bloco **Na prática** dizendo o que fazer.
5. Ao final aparece a **sugestão de preset**. Ela sai da medição, não de chute.

### C. Passo 2: ver *onde* está o problema

Depois de analisar, o clipe ganha uma **faixa fina na base** com marcas
vermelhas onde o som estourou, e a seção lista os **piores momentos com
timecode**. Clicar num momento leva o playhead até lá para você ouvir.

> Quando o material estoura de ponta a ponta — captação ruim de verdade — a
> faixa é quem informa; a lista fica cheia demais para servir. Em material com
> estouro ocasional (uma pancada, uma risada), a lista é o atalho.

### D. Passo 3: escolher o preset

| Preset | Para quê | Espera (entrevista de 22 min) |
|---|---|---|
| **Só entrega** | áudio já limpo, só falta o volume certo | ~43 s |
| **Resgate de captação estourada** | o caso comum: distorcido e barulhento | ~43 s |
| **Ambiência preservada** | rua, feira, som direto — limpar sem matar o ambiente | ~43 s |
| **Prévia rápida** | só normalizar para ouvir | ~43 s |
| **Resgate com IA (lento)** | quando o filtro clássico deixou artefato | **~16 min** |
| **Voz limpa com IA (lento)** | boa captação em que só o chiado incomoda | **~16 min** |

Os dois de IA usam uma rede neural rodando no seu computador. Limpam bem melhor
— o piso de ruído desce cerca de 13 dB a mais — mas são **cerca de 45 vezes mais
lentos** que os outros. Precisam de instalação (veja o README) e o programa avisa
se faltar.

### E. Passo 4: prever antes de comprometer

**Sempre clique em "Prever 15 s" primeiro.** Ele trata só 15 segundos a partir
do ponto de entrada do clipe:

- com preset clássico, responde em cerca de 1 segundo;
- com preset de IA, em cerca de 10 segundos — contra os 16 minutos do clipe
  inteiro.

Ouça o A/B (**Tratado** × **Original**) e só então decida. É a diferença entre
descobrir em 10 segundos que a receita não serve, ou em 16 minutos.

### F. Passo 5: aplicar, comparar e descartar

1. Clique em **Aplicar**. O tratamento entra numa fila e o painel mostra o
   progresso; você continua montando.
2. Quando ficar pronto, a seção **Resultado** mostra os números de antes e
   depois lado a lado, e o caminho do arquivo gerado.
3. Alterne **Tratado** × **Original** para comparar de ouvido.
4. **Descartar** remove o tratamento do clipe. O arquivo continua no disco — se
   você reaplicar a mesma receita, ele volta instantaneamente, sem reprocessar.

### G. Ajustes ao vivo (Equalizador e Dinâmica)

Estes você mexe **durante a reprodução** e ouve na hora:

- **Corte de graves (HPF)** — 80 Hz elimina ruído de mesa, vento e pisada sem
  tocar na voz. É o primeiro a tentar.
- **Graves / Médios / Agudos** — correção de timbre.
- **Gate** — silencia o fundo quando ninguém fala.
- **Compressor** e **ganho de compensação** — emparelham os picos da fala.

Cada seção tem o olho (**bypass**, para comparar com e sem) e a seta
(**reset**). Os valores ficam salvos no clipe e vão junto na exportação — mas
como EQ e compressor **não atravessam FCPXML nem EDL**, eles são declarados num
arquivo `.txt` gerado ao lado do export, para o mixador reproduzir na DAW.

### H. Se você tem conta no Auphonic (nuvem)

Com a chave configurada em **Configurações › Modelos & Chaves**, o motor
**Auphonic** fica disponível. Ele faz o que o processamento local não faz:
remoção de reverberação, realce automático de voz e limpeza preservando a
ambiência.

O plano gratuito são **2 horas por mês**. O painel mostra quanto resta e avisa
quando está acabando. Duas proteções: sem cota suficiente o programa recusa
**antes** de enviar qualquer coisa, e a prévia de 15 s nunca vai para a nuvem —
gastaria cota para responder o que o motor local responde de graça.

> **Conta prática:** não mande a entrevista bruta. Mande o trecho que entra no
> filme. Com o aproveitamento típico de um documentário, as suas horas de bruto
> viram menos de uma hora de material usado — cabe no mês com folga.

Em **Ajustes da nuvem** você vê o que a medição decidiu campo a campo e pode
discordar de qualquer um. Só o que você alterar vai como manual; o resto
continua automático. Uma coisa não é negociável nem ali: **corte automático de
silêncio e de hesitação fica sempre desligado** — documentário não corta
sozinho.

---

## 🔄 7. Carrossel de Alternativas da IA (Atalho A)

Sempre que a IA propuser e inserir um vídeo na timeline, ela indexará
trechos alternativos parecidos do acervo. Isso permite que você
substitua clipes de forma extremamente dinâmica:

1.  **Selecionar e Abrir:** Clique em qualquer clipe gerado pela IA
    (identificado com borda diferenciada) na timeline para selecioná-lo
    e pressione a tecla **A** no teclado.

2.  **Modal com Vídeo Previews:** Um modal com fundo desfocado surgirá
    no centro da tela, exibindo um card para cada clipe alternativo.
    Cada card mostra o vídeo correspondente rodando automaticamente em
    loop silencioso de 5 segundos daquele trecho exato da recomendação.

3.  **Mecanismo de Substituição (Swap):** Abaixo da justificativa de uso
    do clipe, você encontrará dois ícones de linha para substituição:

    - **↔ Slot Fixo:** Substitui a mídia atual pelo candidato
      selecionado, ajustando os pontos de entrada e saída para caber
      exatamente na mesma duração da timeline.

    - **↠ Ripple:** Substitui o clipe aplicando a duração ideal
      recomendada do candidato e empurra (ou puxa) automaticamente todos
      os clipes subsequentes da mesma trilha.

4.  **Desfazer:** Todas as trocas são salvas no histórico local e podem
    ser revertidas com Ctrl+Z.

## 🎬 8. Salvando, Auto-Salvamento & Logs com IA

### A. Auto-Salvamento Automático

Você não precisa se preocupar em salvar manualmente a cada modificação.
O sistema possui um mecanismo de **auto-salvamento em segundo plano**
super otimizado (debounce de 1s) que grava automaticamente no
localStorage do seu navegador:

- **Resiliência Total:** Se você fechar a aba ou atualizar a página com
  F5 ou Ctrl+F5, toda a timeline (cortes, pistas, ghosts) e preferências
  de visualização (zoom, scrolls, playhead, seleções) serão restauradas
  instantaneamente.

- **Histórico Retido:** A pilha completa de Undo/Redo (Ctrl+Z / Ctrl+Y)
  também é restaurada, permitindo continuar desfazendo ações livremente.

- **Por Projeto:** Os auto-salvamentos são salvos individualmente por ID
  de projeto, evitando misturar timelines de trabalhos diferentes.

### B. Salvamento Permanente e Exportação

1.  Para criar uma versão fixa no banco de dados, dê um nome para a sua
    sequência no campo de texto (ex: *Montagem Inicial*).

2.  Clique em **Salvar** para gravar a timeline no SQLite.

3.  Escolha o formato de saída no seletor (XML para
    Premiere/Resolve/FCP, OpenTimelineIO .otio ou EDL).

4.  Clique em **Exportar**. O download iniciará no seu navegador e o
    arquivo estará pronto para ser importado no seu editor NLE
    profissional.

### C. Importação de Timelines (o caminho inverso)

O CapIAu também importa timelines criadas em editores externos
(Kdenlive, Premiere, Resolve, Final Cut) ou exportadas por ele mesmo:

1.  Na barra de ferramentas da timeline, clique no ícone
    **Importar Timeline** (ao lado do Exportar).

2.  Escolha o arquivo: **.otio** (OpenTimelineIO), **.xml**
    (Premiere/Resolve/FCP) ou **.edl**. O nome da nova timeline é
    preenchido automaticamente com o nome do arquivo — ajuste se quiser.

3.  Clique em **Importar**. Cada clipe é **religado à mídia já
    ingerida** no projeto pelo caminho do arquivo (se o caminho mudou,
    o sistema tenta casar pelo nome único do arquivo). Nada é copiado
    nem re-ingerido.

4.  Se algum arquivo não existir no acervo, o clipe vira uma **lacuna
    na posição original** e o diálogo lista tudo o que ficou ausente
    para você religar manualmente depois.

5.  Com a opção **"Carregar na tela após importar"** marcada, a
    timeline importada abre direto na linha do tempo, com pistas,
    posições e lacunas preservadas.

> **Dica:** o formato `.otio` abre sem nenhuma dependência extra. Já
> `.xml` e `.edl` usam os mesmos adaptadores do export — se o Python do
> sistema não tiver o pacote `opentimelineio`, converta a timeline para
> `.otio` no editor de origem ou provisione o venv de exportação
> (`data/venv312`).

### D. Painel de Logs Avançado com IA

Se você encontrar algum erro, quiser auditar as ações de sua edição ou
queira gerar relatórios de forma assistida:

1.  Abra a aba **Logs** na barra lateral direita (ícone de terminal
    \>\_).

2.  Lá você verá o console do sistema registrando ações, requisições de
    APIs e erros em tempo real.

3.  **Assistente de Logs (IA):**

    - **Relatório Humano:** Clique neste botão para que a IA analise os
      logs do terminal e crie uma lista resumida, não-técnica, de tudo o
      que você fez durante a sessão.

    - **Análise Técnica (OR):** Clique neste botão para acionar o
      OpenRouter e realizar uma auditoria técnica profunda nos logs para
      encontrar erros ou sugerir melhorias de desempenho.

    - **Copiar & Limpar:** Use os botões de ação superior para copiar os
      logs formatados para área de transferência ou limpar o histórico
      atual.

## 🎛️ 9. Layout e Organização Avançada

### 📺 Inspetor de Mídia Integrado (Atalho A na Biblioteca)

O sistema conta com um **Inspetor de Mídia Integrado** no menu lateral
esquerdo, projetado para decupagens e análises profundas sem a poluição
de popups flutuantes.

- **Ativação Dinâmica:** Com uma mídia selecionada na biblioteca de
  arquivos, pressione a tecla **A** (ou clique no card/lista). A barra
  lateral direita é ocultada, a barra esquerda se expande para uma área
  maior de destaque (recuperada do localStorage, padrão 650px) e o
  **Source Player** é maximizado automaticamente para inspeção.

- **Abas do Inspetor:**

  - **Índice:** Exibe resumos IA e capítulos navegáveis (seeking no
    player clássico).

  - **Legenda:** Transcrição atômica e falantes editáveis (com dropdown
    inteligente e criação de novos falantes), além de função para
    fatiar/dividir diálogos no ponto da agulha.

  - **Temas:** Adicione e remova temas narrativos diretamente e filtre
    trechos com ponto de In/Out capturados em tempo real.

  - **Rostos:** Galeria de rostos detectados com marcações temporais e
    caixas de texto premium para rotular e desambiguar a identidade dos
    personagens.

  - **IA:** Gatilhos rápidos para processamento individual de ASR, Visão
    (Gemini) e Rostos.

- **Restauração de Estado:** Pressionar a tecla **A** novamente, a tecla
  **Esc** ou clicar em **\"Voltar\"** fecha o Inspetor e restaura a
  biblioteca exatamente como estava (sua aba ativa anterior, a barra
  direita é reaberta e o clipe ativo anterior fica focado e com rolagem
  automática).

### 🎬 Operação e Interatividade Avançada dos Players

Os painéis de monitor de vídeo (Source & Program) foram otimizados com
controles intuitivos rápidos:

- **Play / Pause:** Clique simples na área de vídeo de qualquer player
  ativa ou pausa a reprodução.

- **Maximizar / Minimizar:** Clique duplo rápido na área de vídeo de
  qualquer player expande-o em tela cheia na área de visualização (ou
  restaura a visualização dupla).

- **Atalho de Swap (Q):** Quando um dos players estiver maximizado,
  pressione a tecla **Q** ou clique no ícone de troca (⇄) no cabeçalho
  do player para alternar instantaneamente entre a visualização
  maximizada do Source e do Program.

- **Exibição Inteligente do Program:** Se o Source Player estiver
  maximizado e você interagir com a timeline (clicando em um clipe), o
  sistema detecta que seu foco mudou para a montagem e **abre/maximiza o
  Program Player automaticamente**, garantindo que você veja o resultado
  do corte na linha do tempo.

### Workspace \"Estúdio\" (Layout Flexível de Alta Densidade)

- Para decupagens robustas, ative o botão **Estúdio** no topo da tela.

- Este modo reorganiza completamente a interface. A biblioteca ganha
  espaço predominante. Os dois monitores (Source e Program) são
  empilhados na segunda coluna em formato ultralimpo, onde seus
  controles de player só aparecem no *hover* do mouse
  (position:absolute), e a transcrição fica disponível como uma terceira
  coluna colapsável. A linha do tempo expande em 100% da largura
  inferior.

- **Altura das Pistas:** Tanto no layout Padrão quanto no Estúdio, você
  pode ajustar a altura das trilhas da timeline de duas formas:

  1.  Usando o slider vertical global na barra de ferramentas superior.

  2.  Clicando e arrastando a borda inferior do cabeçalho de uma trilha
      individual à esquerda (para redimensionamentos independentes que
      são salvos na sessão local).

### Reposicionamento dos Controles de Zoom e Modo de Exibição

- Os botões de **Modo de Visualização** (Lista ou Cards) e o controle
  deslizante de **Zoom** das miniaturas foram movidos para a linha
  inferior da barra de ferramentas da biblioteca (Linha 3).

- Todos os controles dessa linha (Zoom, Visualização, Expandir Tudo,
  Recolher Tudo e Abrir Fotos no Player) foram otimizados como ícones
  simples (*line-icons*) livres de contornos e boxes, minimizando a
  poluição visual na biblioteca.

### Inserção Rápida e Arrastar-e-Soltar (Drag-and-Drop)

- Você pode adicionar mídias à timeline de duas formas:

  1.  **Arrastar-e-Soltar:** Clique e segure qualquer vídeo ou foto na
      barra lateral e arraste-o diretamente para a trilha desejada na
      timeline.

  2.  **Inserção Rápida:** Passe o mouse sobre qualquer miniatura de
      foto para revelar um botão flutuante \"+\". O clique adicionará a
      imagem como still (duração padrão de 5s) na timeline no ponto da
      agulha.

## ⚙️ 10. Configurações da Sequência, Auto-Configuração e Zoom do Preview

### A. Auto-Configuração Inteligente da Timeline
Para agilizar o início do trabalho e garantir a consistência técnica, o CapIAu-Talho conta com um sistema de **auto-configuração automática no primeiro clipe**.
- Ao arrastar ou inserir o primeiro clipe de vídeo em uma timeline totalmente vazia, o sistema lê as propriedades técnicas desse vídeo (extraídas via FFprobe na ingestão) e configura automaticamente a resolução (largura e altura) e o FPS da timeline para coincidir com os do vídeo.
- A inserção de imagens estáticas (fotos stills) não dispara a auto-configuração, permitindo que a timeline permaneça nos valores padrão ou nas configurações manuais que você escolher.

### B. Painel de Configurações da Sequência
Sempre que não houver nenhum clipe selecionado na timeline (ou ao acessar a aba **Ajustes** com a seleção limpa), o painel lateral direito exibirá as **Configurações da Sequência**:
- **Presets de Resolução:** Selecione proporções comuns através do menu suspenso, como *1920×1080 (16:9)*, *1080×1920 (9:16 - Vertical)*, *3840×2160 (4K)*, *1080×1080 (1:1)* ou *Personalizado*.
- **Dimensões Customizadas:** Ao selecionar o preset *Personalizado*, os campos de largura e altura numéricos são habilitados para você definir qualquer resolução (como resoluções específicas de redes sociais ou formatos panorâmicos). A proporção da tela é calculada e exibida em tempo real.
- **Controle de FPS:** Altere a taxa de quadros da timeline selecionando opções de *23.976 a 60 FPS*.
- **Aviso e Reescalagem de Frames:** Se você alterar o FPS de uma timeline que já contém clipes de vídeo ou áudio, o sistema exibirá um aviso informando que as posições em frames serão recalculadas. O CapIAu-Talho reajusta os pontos de início e fim dos clipes para **preservar exatamente a sua duração e tempo em segundos**, evitando desalinhamentos. Toda a alteração é gravada no histórico como um único passo e pode ser desfeita pressionando **Ctrl+Z**.

### C. Acesso Rápido e Persistência
- Você pode abrir as configurações da sequência a qualquer momento clicando no botão de **Engrenagem** localizado no cabeçalho do Program Player (ao lado do botão de Popout) ou na barra de ferramentas lateral da timeline (`#timeline-actions-sidebar`).
- As propriedades da sequência são persistidas automaticamente em segundo plano tanto no *localStorage* (autosave) quanto no banco de dados SQLite principal ao salvar a timeline.

### D. Zoom de Visualização do Program Player
No painel do Program Player, ao lado do seletor de resolução, há um seletor de zoom com as opções: **Fit, 25%, 50%, 75% e 100%**:
- **Fit:** Redimensiona dinamicamente a área de renderização para se ajustar perfeitamente ao tamanho da janela e dos splitters do painel, garantindo que toda a sequência fique visível.
- **Percentuais Fixos:** Força o viewport a adotar um tamanho de escala estrito da sequência. Se o clipe escalado exceder o viewport, o transbordo será cortado/escurecido pela máscara, facilitando o alinhamento de detalhes finos sem que a janela de reprodução se desloque.

---

## 📐 11. Viewport Estável, Alças de Transformação e Recorte (Crop)

### A. Viewport Estável e Máscara de Transbordo
A área de visualização da montagem no Program Player agora funciona dentro de um **Viewport Estável** (`#program-player-viewport`):
- O enquadramento visível não é mais afetado pelo tamanho físico da janela do seu navegador ou pela posição das barras divisorias de painéis. O viewport possui dimensões baseadas na proporção real da sequência (ex.: 16:9 ou 9:16).
- **Máscara de Transbordo (Shade Overlay):** Todo conteúdo visual que ultrapassar os limites do enquadramento da sequência (como um clipe escalado ou transladado) fica visível além das bordas pontilhadas, mas é suavizado por uma máscara escura com opacidade de 70%. Isso permite que o editor veja o transbordo e posicione as mídias de forma precisa, sabendo exatamente o que será cortado na exportação.

### B. Alças de Transformação Interativa (Bounding Box)
Ao selecionar qualquer clipe de vídeo ou foto na timeline e posicionar a agulha de reprodução (playhead) sobre ele, uma caixa delimitadora (*bounding box*) ciano se acenderá ao redor da imagem ativa no Program Player:
- **Cálculo Preciso da Imagem:** A caixa delimita o retângulo real do conteúdo visível (*content rect*), compensando faixas pretas ou letterboxes geradas pelo modo *fit/contain*.
- **Mover (Translação X/Y):** Clique e arraste em qualquer parte do interior do clipe selecionado para reposicioná-lo na tela. Os valores de posição X e Y serão atualizados dinamicamente.
- **Escalar (Redimensionamento Uniforme):** Clique e arraste qualquer uma das 4 alças quadradas brancas nos cantos da caixa delimitadora para aumentar ou diminuir a escala do clipe de maneira uniforme.
- **Rotacionar:** Arraste a alça de rotação estendida no topo da caixa para rotacionar o clipe livremente ao redor de seu centro.
- **Integração com o Histórico e Sliders:** 
  - Durante o arraste com o mouse/ponteiro, a imagem se move de forma fluida.
  - Ao soltar o clique, o gesto é consolidado no histórico. Os sliders de transformação na aba **Ajustes** são atualizados automaticamente para refletir os valores finais obtidos pelo gesto.
  - Pressionar **Ctrl+Z** reverte o arraste completo (posição, rotação ou escala) e atualiza o player e a interface de sliders instantaneamente.
  - Cliques curtos sem arrasto na caixa delimitadora do clipe selecionado continuam funcionando normalmente como comando de *Play/Pause* do vídeo.

### C. Efeito de Recorte (Crop)
O CapIAu-Talho suporta o efeito nativo de **Recorte (Crop)** por clipe:
- Na aba **Ajustes**, localize a seção **Recorte (Crop)** (abaixo das transformações geométricas) para ajustar as bordas do clipe individualmente (*Esquerda*, *Direita*, *Topo*, *Base*) de 0% a 90%.
- **Corte Relativo à Imagem:** O recorte é relativo ao conteúdo visível do clipe, o que significa que o ajuste de 10% na esquerda cortará 10% da imagem útil, e não a borda ou a faixa preta de preenchimento.
- **Compatibilidade com Transformações:** O crop é aplicado no pipeline gráfico via CSS `clip-path` antes das rotações e posições do clipe, fazendo com que a área recortada acompanhe perfeitamente a escala, rotação e movimento definidos para o clipe.
- **Preservação de Foco:** O painel de ajustes possui preservação automática de scroll, garantindo que o scroll não pule de volta ao topo quando você interage com os sliders de Crop localizados no rodapé do painel.

### D. Reset de Ajustes por Duplo Clique
Para agilizar o fluxo de edição sem a necessidade de digitar valores numéricos manualmente:
- **Reset Rápido de Sliders:** Dê um **duplo clique** sobre o nome do parâmetro ou sobre qualquer controle deslizante (slider) no painel **Ajustes** (Posição X/Y, Rotação, Escala, Crop, Volume, Fades).
- O parâmetro retornará instantaneamente ao seu valor padrão (ex.: Posição X/Y em 0, Escala em 100%, Rotação em 0°, Crop em 0%, Volume em 100%).
- A alteração é registrada no histórico de edição e pode ser desfeita pressionando **Ctrl+Z**.

---

## 🤖 12. Resiliência de IA, Seleção de Modelos e Gestão de Tarefas

### A. Seleção e Fallback Automático de Modelos de Visão
No painel de Configurações de IA, você pode definir o modelo de visão utilizado para decodificar e descrever os frames do acervo:
- **Seleção de Modelos Gratuitos e Pagos:** Escolha entre o **Nvidia Nemotron 70B Vision** (gratuito e de alto desempenho) ou os modelos **Gemini 2.5 Flash / 3.1 Flash Lite**.
- **Mecanismo de Fallback em Cascata:** Em caso de indisponibilidade temporária da API escolhida (ex.: erro de cota ou instabilidade de rede), o sistema tenta automaticamente o modelo substituto em cascata (Nemotron → Gemini 2.5 Flash → Gemini 3.1 Flash Lite).
- **Proteção Anti-Sobrescrita:** Se todas as chamadas de API falharem por algum motivo, o sistema preserva integralmente as descrições e categorias boas que já foram salvas anteriormente no banco de dados, evitando a perda de metadados.
- **Gestão de Tokens (`max_tokens`):** As chamadas de IA utilizam um teto explícito de tokens de saída para evitar que o provedor de nuvem (OpenRouter) reserve créditos excessivos, garantindo máxima economia e evitando erros 402 ("requires more credits").

### B. Gerenciador de Tarefas de Miniaturas
No painel de monitoramento de tarefas e status da mídia:
- **Controle Total de Miniaturas:** Visualize o progresso da geração de miniaturas progressivas.
- **Ações Rápidas:** Botões dedicados para **Pausar**, **Cancelar**, **Remover** e **Sincronizar** a geração de miniaturas para liberar recursos do sistema quando necessário.

---

## 🖥️ 13. Execução Resiliente sem Janela de Console no Windows

Para evitar que o servidor FastAPI ou os workers de background sejam encerrados por acidentes no Windows (como ao fechar a janela do prompt de comando, o que envia um sinal `CTRL_CLOSE_EVENT` que interrompe o runtime Fortran/MKL do PyTorch):

1. **Utilize o Lançador Autônomo:**
   No terminal na pasta do projeto, execute:
   ```bash
   python scripts/launch_detached.py
   ```
2. **Operação Desvinculada:** O lançador cria o processo do backend de forma totalmente desvinculada do console pai (`DETACHED_PROCESS`). O servidor continuará rodando de forma segura em background na porta 8000 mesmo se o terminal for fechado.

---

## ⚡ 14. Configurações de Hardware, Aceleração por GPU e Fallback Automático

O CapIAu-Talho inclui uma aba dedicada de **Hardware & GPU** no Painel de Configurações (ícone de engrenagem no cabeçalho), permitindo extrair o máximo de desempenho da sua placa gráfica (Intel QuickSync, AMD Radeon, Nvidia) enquanto protege o computador contra travamentos com **fallback automático para CPU**.

### A. Opções Disponíveis na Aba Hardware & GPU

1. **Codificador de Vídeo (Proxies / Exportação):**
   - **Automático (Detectar GPU com fallback CPU)** *(Padrão recomendado)*: Detecta automaticamente o melhor acelerador de vídeo instalado no seu computador.
   - **Intel QuickSync Video (`h264_qsv`)**: Utiliza o motor de codificação de vídeo integrado dos processadores Intel para gerar proxies ultrarrápidos com quase 0% de uso da CPU.
   - **AMD Advanced Media Framework (`h264_amf`)**: Utiliza a GPU dedicada AMD Radeon para processamento de vídeo.
   - **Nvidia NVENC (`h264_nvenc`)**: Utiliza os núcleos NVENC dedicados das placas Nvidia GeForce/RTX.
   - **Software CPU (`libx264`)**: Codificação clássica por processador para compatibilidade universal.

2. **Decodificação de Vídeo por Hardware:**
   - **Automático (Direct3D 11 / DXVA2)** *(Padrão)*: Usa a GPU para descompactar vídeos 1080p/4K durante a extração de miniaturas e navegação de frames, reduzindo o aquecimento e o consumo da CPU.
   - **Direct3D 11 (`d3d11va`)** / **DirectX 9 (`dxva2`)** / **Nvidia CUDA (`cuda`)** / **Desativado (CPU pura)**.

3. **Aceleração OpenCL no OpenCV:**
   - Ativa o processamento gráfico paralelo (`cv2.ocl.setUseOpenCL(True)`) para operações de matrizes, filtros de nitidez, realce de contraste CLAHE e redimensionamento de fotos, liberando a CPU sem gastar memória de vídeo dedicada (VRAM).

4. **Dispositivo para Modelos de IA (CLIP / Embeddings):**
   - **Automático (Seguro para economizar VRAM)** *(Padrão)*: Mantém os modelos de busca semântica (CLIP e MiniLM) operando de forma leve, preservando os 2.0 GB de VRAM dedicados da GPU para o trabalho pesado de decodificação e codificação de vídeo.
   - **Opções de DirectML e CUDA**: Disponíveis para máquinas com GPUs de maior capacidade (4 GB+ de VRAM).

### B. Como Funciona o Fallback Automático e Silencioso
O sistema opera com tolerância total a falhas:
- Se você importar dezenas de vídeos ao mesmo tempo e o chip de vídeo atingir o limite físico de sessões de codificação simultâneas, ou se um arquivo de vídeo com perfil exótico for rejeitado pela GPU, o FFmpeg avisa o backend.
- O CapIAu-Talho realiza uma **transição instantânea para a CPU (`libx264`)** sem interromper a fila de tarefas, sem emitir erros na tela e garantindo que todos os proxies e miniaturas sejam gerados com sucesso.

### C. Tooltips Didáticas e Técnicas (Ícone ⓘ)
Ao lado de cada configuração no painel, passe o mouse sobre o ícone **ⓘ** para visualizar uma tooltip técnica aprofundada com os detalhes de codecs, flags internas do FFmpeg e gerenciamento de memória.

---

## 🎹 15. Mapa de Atalhos de Teclado NLE

Para máxima agilidade na ilha de edição, utilize os atalhos de teclado profissionais suportados nativamente pelo CapIAu-Talho:

| Categoria | Atalho | Ação |
| :--- | :---: | :--- |
| **Reprodução & Scrubbing** | **`Espaço`** | Play / Pause no player ativo |
| | **`J`** | Retroceder reprodução (1x, 2x, 4x, 8x) |
| | **`K`** | Parar reprodução |
| | **`L`** | Avançar reprodução (1x, 2x, 4x, 8x) |
| | **`←` / `→`** | Avançar / Retroceder 1 frame |
| | **`Shift + ←` / `→`** | Saltar 1 segundo |
| **Pontos de Corte** | **`I`** | Marcar ponto de Entrada (*IN*) |
| | **`O`** | Marcar ponto de Saída (*OUT*) |
| | **`Alt + X`** | Limpar pontos de In e Out |
| | **`E`** | Inserir trecho selecionado na timeline |
| | **`Shift + E`** | Inserir texto ou fala selecionada na timeline |
| **Edição na Linha do Tempo** | **`Z`** | Dividir (*Split*) clipe na posição da agulha |
| | **`U`** | Desvincular (*Unlink*) ou Vincular áudio e vídeo |
| | **`Delete` / `Backspace`** | Excluir clipe(s) selecionado(s) |
| | **`Ctrl + Z`** | Desfazer (*Undo*) |
| | **`Ctrl + Y` / `Ctrl + Shift + Z`** | Refazer (*Redo*) |
| **Marcadores** | **`M`** | Criar ou editar marcador na agulha |
| | **`Shift + M`** | Saltar para o próximo marcador |
| | **`Alt + M`** | Retroceder para o marcador anterior |
| | **`Shift + Clique`** | Selecionar múltiplos marcadores para exclusão em lote |
| **Inteligência Artificial & Players** | **`A`** | Carrossel de alternativas da IA / Abrir Inspetor de Mídia |
| | **`Q`** | Alternar maximização entre Source Player e Program Player |
| | **`Enter` / `Y`** | Aceitar sugestão da IA (*Ghost Clip*) selecionada |
| | **`Esc`** | Fechar modais, desmarcar ou sair do Inspetor de Mídia |


