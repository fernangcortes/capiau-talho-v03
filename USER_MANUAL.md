# Manual do Usuário: CapIAu-Talho Making Of Editor

Bem-vindo ao **CapIAu-Talho Making Of Editor**. Este guia mostra, passo a passo, como importar suas mídias, transcrever depoimentos, buscar imagens por significado, conversar com o agente de edição, montar a timeline e exportar o resultado.

---

## Como usar este manual

- **Está começando?** Leia o caminho [Do ingest à exportação](#do-ingest-à-exportação) logo abaixo e depois as seções 1 e 2.
- **Já edita em outro programa?** Procure as caixas **Vindo do Premiere/Resolve/FCP/Kdenlive** ao longo da seção 5 e a seção 14 (atalhos).
- **Algo deu errado?** Vá direto para [Problemas comuns por sintoma](#problemas-comuns-por-sintoma).
- **Convenções:** as caixas abaixo aparecem ao longo do texto.

> **Dica:** atalhos e truques que economizam tempo.

> **Atenção:** situações em que você pode perder trabalho ou obter um resultado diferente do esperado.

> **Vindo do Premiere/Resolve/FCP/Kdenlive:** comparações com o que você já conhece.

**Jargão.** Alguns termos de edição e de IA aparecem com frequência. Cada um tem explicação no [Glossário Visual e Terminologia](https://github.com/fernangcortes/capiau-talho-v03/wiki/18.-Glossario-Visual-e-Terminologia):
[ripple](https://github.com/fernangcortes/capiau-talho-v03/wiki/18.-Glossario-Visual-e-Terminologia),
[gap](https://github.com/fernangcortes/capiau-talho-v03/wiki/18.-Glossario-Visual-e-Terminologia),
[overwrite](https://github.com/fernangcortes/capiau-talho-v03/wiki/18.-Glossario-Visual-e-Terminologia),
[J/L-cut](https://github.com/fernangcortes/capiau-talho-v03/wiki/18.-Glossario-Visual-e-Terminologia),
[diarização](https://github.com/fernangcortes/capiau-talho-v03/wiki/18.-Glossario-Visual-e-Terminologia),
[LUFS](https://github.com/fernangcortes/capiau-talho-v03/wiki/18.-Glossario-Visual-e-Terminologia),
[proxy](https://github.com/fernangcortes/capiau-talho-v03/wiki/18.-Glossario-Visual-e-Terminologia) e
[RAG](https://github.com/fernangcortes/capiau-talho-v03/wiki/18.-Glossario-Visual-e-Terminologia).

---

## Novidades (10/2026)

| Novidade | O que muda para você | Onde ler |
|---|---|---|
| **Trava de pista (cadeado)** | Cada pista ganhou um cadeado que bloqueia qualquer edição nela. Não é o mesmo que o Sync Lock. | [5.11](#511-controles-nativos-de-pistas-mute-solo-sync-lock-e-trava) |
| **Margens de segurança e máscaras de proporção** | O Program Player pode mostrar guias de Action Safe e Title Safe e máscaras 16:9, 9:16, 1:1 e 2.39:1. | [9.2](#92-operação-dos-players) |
| **Camada facial no Source Player** | Um botão liga as caixas de rostos no Source; segurar `Alt` espia as caixas por um instante. | [4.1](#41-exibição-e-desenho-livre-no-player) |
| **Diálogos próprios** | Confirmações e campos de nome agora são janelas do próprio CapIAu e também funcionam em painéis destacados em outro monitor. | [9.6](#96-janelas-destacadas-em-vários-monitores) |

---

## Do ingest à exportação

O caminho completo, do material bruto ao arquivo final:

| Etapa | O que fazer | Onde |
|---|---|---|
| 1. Preparar | Dê nomes úteis aos arquivos e coloque-os em `watch/` | [Seção 1](#1-estrutura-de-pastas-e-organização-das-mídias) |
| 2. Ingerir | Menu **Importar** › **Escanear a pasta watch/** | [2.1](#21-ingestão-de-mídias) |
| 3. Transcrever | **Transcrever Vídeo Atual** e corrigir falantes | [2.2](#22-transcrição-e-diarização-de-entrevistas) |
| 4. Decupar | Análise visual dos B-rolls e fotos, rostos e temas | [2.3](#23-decupagem-visual-de-b-rolls-e-fotos), [Seção 4](#4-mapeamento-de-rostos-objetos-e-desambiguação-rápida) |
| 5. Buscar | Busca por significado e playlist de resultados | [2.5](#25-busca-semântica-híbrida-e-controles-de-playlist) |
| 6. Montar | Arraste para a timeline, use 3 e 4 pontos, peça ajuda ao agente | [Seção 3](#3-assistente-conversacional-de-edição-chat-agente-e-ghost-clips), [Seção 5](#5-timeline-multipista-gaps-sync-lock-e-jl-cuts) |
| 7. Refinar | Velocidade, congelar quadro, recorte, títulos | [5.19](#519-velocidade-do-clipe-reprodução-reversa-e-preenchimento-de-lacunas), [Seção 11](#11-viewport-estável-alças-de-transformação-e-recorte-crop), [Seção 17](#17-gerador-e-editor-de-títulos-legendas-e-cartelas) |
| 8. Tratar o áudio | Diagnóstico, preset, prévia de 15 s | [Seção 6](#6-tratamento-de-áudio-diagnóstico-presets-e-comparação-ab) |
| 9. Salvar | Dê nome à sequência e clique em **Salvar** | [8.2](#82-salvamento-permanente-e-exportação) |
| 10. Entregar | **Exportar vídeo** (MP4) ou enviar XML/OTIO/EDL ao seu editor | [Seção 16](#16-exportar-vídeo-render-da-timeline-em-mp4), [8.2](#82-salvamento-permanente-e-exportação) |

---

## Índice

1. [Estrutura de pastas e organização das mídias](#1-estrutura-de-pastas-e-organização-das-mídias)
2. [Fluxo de trabalho passo a passo](#2-fluxo-de-trabalho-passo-a-passo)
   - [2.1 Ingestão de mídias](#21-ingestão-de-mídias)
   - [2.2 Transcrição e diarização de entrevistas](#22-transcrição-e-diarização-de-entrevistas)
   - [2.3 Decupagem visual de B-rolls e fotos](#23-decupagem-visual-de-b-rolls-e-fotos)
   - [2.4 Agrupamento em temas](#24-agrupamento-em-temas)
   - [2.5 Busca semântica híbrida e controles de playlist](#25-busca-semântica-híbrida-e-controles-de-playlist)
3. [Assistente conversacional de edição (Chat-Agente) e Ghost Clips](#3-assistente-conversacional-de-edição-chat-agente-e-ghost-clips)
4. [Mapeamento de rostos, objetos e desambiguação rápida](#4-mapeamento-de-rostos-objetos-e-desambiguação-rápida)
5. [Timeline multipista, gaps, Sync Lock e J/L-cuts](#5-timeline-multipista-gaps-sync-lock-e-jl-cuts)
6. [Tratamento de áudio: diagnóstico, presets e comparação A/B](#6-tratamento-de-áudio-diagnóstico-presets-e-comparação-ab)
7. [Carrossel de alternativas da IA](#7-carrossel-de-alternativas-da-ia)
8. [Salvando, auto-salvamento, importação e logs](#8-salvando-auto-salvamento-importação-e-logs)
9. [Layout e organização avançada](#9-layout-e-organização-avançada)
10. [Configurações da sequência e zoom do preview](#10-configurações-da-sequência-e-zoom-do-preview)
11. [Viewport estável, alças de transformação e recorte (Crop)](#11-viewport-estável-alças-de-transformação-e-recorte-crop)
12. [Seleção de modelos de IA e gestão de tarefas](#12-seleção-de-modelos-de-ia-e-gestão-de-tarefas)
13. [Hardware, aceleração por GPU e fallback automático](#13-hardware-aceleração-por-gpu-e-fallback-automático)
14. [Atalhos de teclado e perfis NLE](#14-atalhos-de-teclado-e-perfis-nle)
15. [Formas de onda (waveforms)](#15-formas-de-onda-waveforms)
16. [Exportar vídeo: render da timeline em MP4](#16-exportar-vídeo-render-da-timeline-em-mp4)
17. [Gerador e editor de títulos, legendas e cartelas](#17-gerador-e-editor-de-títulos-legendas-e-cartelas)
18. [Instalação e inicialização (resumo)](#18-instalação-e-inicialização-resumo)
19. [Problemas comuns por sintoma](#problemas-comuns-por-sintoma)

---

## 1. Estrutura de pastas e organização das mídias

O CapIAu-Talho usa a seguinte estrutura local no seu computador:

| Pasta | Para que serve |
|---|---|
| `watch/` | Porta de entrada. Qualquer vídeo, áudio ou foto colocado aqui é identificado para processamento. |
| `data/originals/` | Mídias originais copiadas com segurança pelo sistema. |
| `data/proxies/` | Proxies leves (720p/360p) gerados automaticamente para a reprodução fluida no navegador. |
| `data/exports/` | Arquivos finais de edição (XML, EDL, OTIO). |

### Regra de ouro para nomear arquivos

Para a IA classificar seus clipes logo na ingestão:

- Depoimentos falados de equipe ou elenco devem ter **entrevista** ou **depoimento** no nome (ex.: `entrevista_diretor_lentes.mp4`). Entram como **Entrevistas (ASR)**.
- Cenas de bastidores ou do set devem ter outros nomes (ex.: `set_bastidores_vfx_take1.mp4`). Entram como **Bastidores (B-Roll)**.

---

## 2. Fluxo de trabalho passo a passo

### 2.1 Ingestão de mídias

1. Copie vídeos de entrevistas, B-rolls ou fotos do set para a pasta `watch/`.
2. No cabeçalho, abra o menu **Importar** e clique em **Escanear a pasta watch/**. No mesmo menu há a opção **HD externo em modo link…** para catalogar mídias sem copiá-las.
3. O sistema lê a pasta, calcula uma assinatura de cada arquivo (evitando duplicatas), extrai os metadados e começa a gerar os proxies em segundo plano.
4. As mídias aparecem na barra lateral esquerda, nas abas **Vídeos** e **Fotos**.

### 2.2 Transcrição e diarização de entrevistas

1. Na aba **Vídeos**, clique em uma entrevista (ela começa a tocar no player).
2. No menu lateral direito, clique em **Transcrever Vídeo Atual**.
3. A transcrição roda na nuvem (AssemblyAI, usando a sua chave) e o texto completo aparece no painel direito, dividido por falantes (ex.: *Speaker A*, *Speaker B*) com marcas de tempo.
4. **Dica de ouro:** clique em qualquer palavra ou frase e o player pula exatamente para aquele ponto da fala.
5. **Assistente de diarização.** Na parte superior direita da transcrição está a **Gaveta de Pistas**, que aponta possíveis erros de atribuição de falante (falas muito longas com silêncio no meio, ou um rosto diferente do falante indicado).
6. **Inspetor de Balão (waveform).** Clique com o botão direito sobre o nome de um falante em um balão de transcrição. Uma gaveta lateral mostra o **Inspetor de Fala**, com uma forma de onda interativa:
   - **Dividir falas:** clique duas vezes em qualquer ponto da onda para dividir a fala naquele instante. O player navega direto para o trecho.
   - **Atribuição rápida de rosto:** o inspetor detecta quem aparece no vídeo naquele trecho e sugere o nome em um menu suspenso, para você corrigir o falante com um clique.

> **Atenção:** a transcrição local (sem nuvem) é experimental e pode ser bem lenta em máquinas modestas. A nuvem segue como caminho recomendado.

### 2.3 Decupagem visual de B-rolls e fotos

1. Os vídeos de B-roll são **segmentados em cortes reais** (shots). Planos-sequência longos são subdivididos em *beats* quando o conteúdo visual muda, e o sistema classifica o movimento de câmera (estático, pan, tilt, caminhando, mão livre). Um quadro representativo de cada segmento é enviado ao modelo de visão configurado (padrão: Gemini 2.5 Flash, via OpenRouter). Cada resultado de busca abre exatamente o trecho do corte, não um intervalo arbitrário.
2. A IA gera descrições narrativas e etiquetas visuais automáticas (ex.: câmera, luz, dolly).
3. As fotos de set passam pela mesma análise e ficam catalogadas na aba **Fotos** com descrições ricas.
4. **Busca visual e "Encontrar Similares"** (sem custo de API): todo quadro de vídeo e foto também é indexado localmente por um modelo CLIP multilíngue. Isso permite buscar por conceito puramente visual (ex.: *"contraluz na janela"*) e usar o botão **Encontrar Similares**, disponível ao passar o mouse sobre os cartões de foto, no rodapé do visualizador (lightbox) e na aba **IA** do Inspetor de Mídia (que usa o quadro atual do player como referência).

### 2.4 Agrupamento em temas

1. Depois de transcrever as entrevistas principais, clique em **Organizar com IA** no cabeçalho.
2. A IA lê as transcrições e propõe de 5 a 10 temas sobre o making of (ex.: *Lentes Anamórficas*, *Fotografia*, *Roteiro*), usando o modelo de texto configurado (veja a [seção 12](#12-seleção-de-modelos-de-ia-e-gestão-de-tarefas)).
3. Os temas aparecem na aba **Temas** da barra lateral esquerda.

### 2.5 Busca semântica híbrida e controles de playlist

No campo de busca do topo, pesquise por conceitos (ex.: *"diretor falando sobre iluminação"* ou *"câmeras no set"*). A busca por significado retorna falas de entrevistas, quadros de B-roll e fotos no painel direito. Clicar em um resultado abre a mídia correspondente.

- **Agrupamento por arquivo.** Os resultados são deduplicados por mídia. Ocorrências adicionais do mesmo vídeo ficam numa seção expansível sob o cartão principal (**Ver mais ocorrências**).
- **Pré-visualização ao passar o mouse.** Após 400 ms sobre um resultado, aparece um popover com um loop mudo de 5 segundos do trecho (ou a foto).
- **Playlist e autoplay.** No topo dos resultados há os botões Retroceder, Autoplay e Avançar. Clicar em um cartão o destaca e ativa a playlist. No Autoplay, os vídeos tocam nos pontos certos e passam sozinhos ao próximo; as fotos ficam 4 segundos dentro da área do player.
- **Abrir fotos no player.** Marque **Abrir fotos no player de vídeo** (na aba de fotos da biblioteca ou na barra de opções da busca; as duas caixas ficam sincronizadas) para que o clique em uma foto abra no player, e não no visualizador.
- **Busca por similaridade em lote.** Selecione vários cartões na biblioteca e dispare a busca por similaridade visual; o sistema lista as mídias do acervo que mais se parecem com o conjunto.
- **Explicações da busca (RAG).** Nos resultados da busca e nas recomendações da IA, uma breve justificativa diz *por que* aquele corte foi considerado relevante.
- **Filtro por status.** O botão de status da barra da biblioteca alterna, a cada clique, entre *Todos os arquivos*, *Apenas analisados (IA)*, *Não analisados (pendentes)* e *Arquivos com erro*.

---

## 3. Assistente conversacional de edição (Chat-Agente) e Ghost Clips

O painel de Chat funciona como um **agente editor ativo**: ele altera a sua timeline a partir de ordens em texto (ex.: *"insira o clipe 2 na pista V1"*, *"aplique um fade de 1 s no primeiro clipe"*, *"cubra o depoimento do diretor com B-rolls do set"*).

### Modo direto e modo rascunho (Ghost Clips)

- Edições pontuais (inserir ou ajustar um único clipe) são aplicadas **diretamente na timeline** e podem ser desfeitas com `Ctrl+Z`.
- Edições em massa ou destrutivas (substituições amplas, rough cuts automáticos) aparecem como **clipes fantasmas (ghost clips)** hachurados: verde para inserções e substituições, vermelho para remoções.

### Ações sobre Ghost Clips

- **Aceitar:** selecione o clipe fantasma e pressione `Enter` (ou `Y`), ou clique no botão de confirmar do popup.
- **Rejeitar:** selecione o clipe fantasma e pressione `Delete` (ou `N`), ou clique no botão de descartar do popup.

> **Dica:** como o mesmo atalho pode ter outro papel fora desse contexto (por exemplo, `Delete` apaga clipes normais), as teclas de aceitar e rejeitar só valem com um ghost clip selecionado. Veja a regra de contexto na [seção 14](#14-atalhos-de-teclado-e-perfis-nle).

### O agente também entende de áudio

Quando você pergunta sobre som, ele vira técnico de áudio, mas continua montador no resto da conversa. A diferença para um assistente genérico é que ele **mede antes de opinar**.

O que dá para pedir:

- *"esse clipe está estourado?"*: ele roda a análise e responde com os números medidos.
- *"o que você faria com esse áudio?"*: diz qual preset resolve, quanto custa em tempo e o que aquele preset **não** resolve.
- *"aplica aí"*: trata uma prévia de 15 s, não o clipe inteiro.
- *"tira o chiado desse trecho"*: mexe nos ajustes ao vivo (EQ, gate, compressor), que são reversíveis e não geram arquivo.

Três coisas ele **não** faz sozinho, de propósito:

1. **Não compromete um render longo** por iniciativa própria. Para tratar o clipe inteiro, pede a sua confirmação.
2. **Não aciona o Auphonic.** Gastaria a sua cota mensal. Se o material pedir nuvem, ele recomenda e explica; quem aperta o botão é você.
3. **Não liga corte automático** de silêncio ou de hesitação. É a regra do documentário.

---

## 4. Mapeamento de rostos, objetos e desambiguação rápida

O CapIAu-Talho tem uma interface completa para gerenciar as marcações de pessoas e elementos do set.

### 4.1 Exibição e desenho livre no player

- **Caixas de rostos e objetos.** Ficam ocultas por padrão, para não poluir o vídeo. Aparecem ao passar o mouse perto do rosto ou objeto quando o player está **pausado**.
- **Camada facial no Source Player (novo).** O botão de detecção facial na barra do Source Player (tooltip *Alternar Detecção Facial no Source*) liga e desliga a camada de caixas de rostos de forma permanente; o atalho padrão é `Ctrl+Alt+B`. A escolha é lembrada pelo navegador. Com a camada desligada, ainda dá para espiar: **segure `Alt` com o mouse sobre o Source Player** e as caixas aparecem enquanto você mantiver a tecla (alt-peek).
- **Desenhar novas caixas.** Para cadastrar um objeto do cenário (ex.: abajur, microfone de lapela) ou uma pessoa não detectada:
  1. Pause o vídeo no quadro desejado.
  2. Clique com o botão esquerdo e arraste sobre o objeto para desenhar um retângulo pontilhado roxo.
  3. Ao soltar, o CapIAu abre um diálogo pedindo o nome. Digite o nome do objeto ou da pessoa (ou escolha uma sugestão da lista) e confirme.
  4. O retângulo se fixa na tela e as etiquetas da aba **Visão IA** são atualizadas.

### 4.2 Desambiguação rápida em tela cheia

Na aba **Grupos de Rostos**, clique em **Desambiguação Rápida** para abrir o gerenciador em tela cheia, com todas as detecções ainda sem nome ou não validadas:

- **Contexto ao passar o mouse.** Se uma miniatura estiver desfocada ou muito próxima, deixe o mouse sobre o cartão: um popover mostra a foto original completa ou um trecho de vídeo de 5 s em loop ao redor daquele quadro.
- **Marcar como objeto ou rejeitar.** Clique no ícone vermelho de banir no canto do cartão. O diálogo pergunta se o elemento é um objeto relevante do cenário. Se for (ex.: câmera), digite o nome. Se for só ruído visual, deixe em branco e confirme: o elemento fica como *Não Relevante* e é ignorado pelas descrições da IA.
- **Seleção em massa.** Selecione vários cartões e, na barra inferior, digite um nome e clique em **Aplicar** para nomear todos de uma vez. Se o nome já pertencer a outro grupo, os grupos são mesclados em segundo plano. **Descartar** rejeita todas as marcações selecionadas.

---

## 5. Timeline multipista, gaps, Sync Lock e J/L-cuts

O CapIAu-Talho usa a organização clássica por pistas dos editores profissionais, com várias pistas de vídeo (V1, V2...) e de áudio (A1, A2...) independentes.

> **Vindo do Premiere/Resolve/FCP/Kdenlive:** a lógica é a mesma das pistas do Premiere e do Resolve. Se você vem do Final Cut Pro, pense em cada pista como uma "via" fixa, sem a linha magnética: nada empurra nada sem que você peça (veja 5.3).

### 5.1 Posicionamento livre

- Cada clipe tem posição temporal absoluta. Arrastar um vídeo ou foto para a timeline o coloca exatamente onde você soltou, o que permite criar pausas e respiros naturais.
- Vídeos e fotos em V2 sobrepõem visualmente o material de V1 nos trechos correspondentes.

### 5.2 Gaps como objetos selecionáveis

- Clique em qualquer espaço vazio entre clipes para selecionar o **gap**; ele fica com um retângulo tracejado ciano.
- Com o gap selecionado, `Delete` ou `Backspace` elimina o espaço: os clipes seguintes, nas pistas com Sync Lock ativo, avançam para fechar o buraco.

### 5.3 Overwrite e ripple insert

- **Arraste padrão (overwrite / livre):** mover um clipe ou soltar uma mídia da biblioteca o posiciona onde está o cursor, respeitando o snapping, sem empurrar os clipes à direita.
- **Modo inserção (`Ctrl` + arrastar ou soltar):** com `Ctrl` (`Cmd` no Mac) pressionado, aparece uma linha guia vertical roxa com setas. Ao soltar, o **ripple insert** abre espaço e empurra os clipes posteriores nas pistas com Sync Lock ativo.

### 5.4 Snapping magnético

- A tecla `N` (ou `Shift+S`) liga e desliga o encaixe magnético global.
- Durante o arrasto de clipes, marcadores ou da agulha (playhead), uma linha guia vertical tracejada ciano cruza todas as pistas no instante em que as bordas se alinham.

### 5.5 Lift delete e ripple delete

| Operação | Atalho (perfil CapIAu) | O que faz |
|---|---|---|
| **Ripple delete** | `Backspace`, `R` ou `Shift+Delete` | Remove o clipe selecionado, o gap selecionado ou o elemento sob a agulha e **fecha o espaço**, puxando os cortes posteriores das pistas com Sync Lock. |
| **Lift delete** | `Delete` ou `Alt+R` | Remove o clipe e deixa um **gap** no lugar, sem mexer nos demais. |

### 5.6 Edição rápida com uma mão (Q-W-E-R e A-S-D-F)

Para montar rápido com a mão esquerda, sem depender do mouse:

- `Q` (ripple trim head): corta do início do clipe até a agulha e fecha o vão.
- `W` (ripple trim tail): corta da agulha até o fim do clipe e fecha o vão.
- `E`: divide o clipe sob a agulha, sem seleção prévia (se houver clipe selecionado, divide o selecionado).
- `R`: ripple delete do clipe ou gap selecionado (ou do que estiver sob a agulha).
- `A` e `S`: levam a agulha ao ponto de corte anterior e ao seguinte.
- `D`: seleciona o clipe sob a agulha na pista ativa. `Shift+D` seleciona todos os clipes sob a agulha nas pistas destravadas, somando à seleção.
- `F`: ativa ou desativa o clipe. Clipes desativados ganham hachura diagonal e a etiqueta `[DESATIVADO]`, ficam sem áudio no player e são ignorados na exportação.

> **Atenção:** `A` tem papéis diferentes conforme o contexto. Com o foco na timeline, pula para o corte anterior; com a biblioteca ou o Source Player em foco, abre o Inspetor de Mídia (seção 9.1).

### 5.7 Seleção acompanha a agulha

Ativo por padrão. Ao navegar (`J`/`K`/`L`, setas, `A`/`S` ou arrastando na régua), o clipe que cruza a agulha na pista ativa é selecionado automaticamente, o que permite fazer trims, divisões e ajustes no Inspetor sem tocar no mouse. Alterne com `Ctrl+Alt+P` ou pelo botão com indicador ciano na barra de ferramentas.

### 5.8 Vínculo de clipes (A/V) e J/L-cuts

- **Vínculo automático.** Vídeo e seu áudio entram acoplados: ao mover o vídeo, o áudio acompanha em sincronia.
- **J-cut e L-cut.** Para fazer edições independentes (por exemplo, estender o áudio de uma fala sobre o B-roll seguinte), selecione o clipe e desvincule o par com `Ctrl+Shift+U`. Depois disso, você pode mover e aparar cada pista separadamente.
- **Ripple trim.** Arraste a borda de corte segurando `Ctrl` para ajustar a duração e empurrar ou puxar os clipes seguintes nas pistas com Sync Lock.

> **Atenção:** a tecla `U` sozinha não desvincula: ela seleciona a ferramenta **Slide**. Em alguns contextos `Ctrl+L` também desvincula, mas ele serve ao loop de reprodução; prefira `Ctrl+Shift+U`.

### 5.9 Dividir o clipe na agulha

`E` ou `Z` cortam o clipe sob a agulha, sem seleção prévia. Se o vídeo tem áudio vinculado, o corte vale para os dois; `Alt+E` ou `Alt+Z` dividem só a pista selecionada.

### 5.10 Compatibilidade de volume em sobreposições

Efeitos de volume em B-rolls e J/L-cuts, inclusive os gerados pela IA ou vindos de montagens externas, são reconhecidos normalmente. Arrastar a agulha e reproduzir atravessam sobreposições, fades e crossfades sem travar.

### 5.11 Controles nativos de pistas (mute, solo, sync lock e trava)

Cada cabeçalho de pista (V1/V2 para vídeo, A1/A2 para áudio) tem botões próprios:

- **Mute:** silencia o áudio da pista.
- **Solo:** isola a pista, silenciando ou ocultando temporariamente as demais.
- **Sync Lock:** define se a pista acompanha as operações de ripple (cor ciano = ativo).
- **Trava (cadeado):** protege a pista contra qualquer edição.
- **Visibilidade (olho):** oculta a imagem da pista no Program Player.

#### Trava de pista × Sync Lock

Os dois são "travas", mas fazem o oposto um do outro:

| | **Sync Lock** | **Trava de pista (cadeado)** |
|---|---|---|
| Pergunta que responde | "Esta pista **acompanha** o ripple?" | "Esta pista **pode ser editada**?" |
| Quando ligado | A pista se desloca junto com fechamentos de gap, ripple delete e ripple insert, mantendo a sincronia com o resto. | **Nada** na pista pode ser movido, aparado, dividido ou apagado, nem por você, nem em ripple, nem pelas ferramentas de seleção. |
| Quando desligado | A pista fica parada no tempo durante o ripple (bom para música e ambiente). | A pista volta a ser editável. |
| Uso típico | Manter trilha musical no lugar enquanto o diálogo é encurtado. | Proteger uma pista já aprovada (ex.: música, narração fechada). |

Atalhos no perfil CapIAu:

- `Shift+L`: trava ou destrava a **pista ativa**.
- `Ctrl+Alt+Shift+L`: trava ou destrava **todas** as pistas (vídeo, áudio e texto).

O botão de cadeado mostra o cadeado fechado quando a pista está travada, e o tooltip indica o atalho em uso. Pistas travadas também são ignoradas pelos comandos que agem "em todas as pistas", como o `Shift+D`.

> **Dica:** combine os dois. Uma trilha musical pode estar com **Sync Lock desligado** (não se move durante os ripples) e **trava ligada** (você não a desloca sem querer ao mexer em outras coisas).

> **Vindo do Premiere/Resolve/FCP/Kdenlive:** o Sync Lock é equivalente ao "Sync Lock" do Premiere e ao "Auto Select" invertido do Resolve; a trava de pista corresponde ao cadeado "Lock Track" (Premiere/Resolve).

### 5.12 Marcadores de timeline e de clipe

- **Marcadores de régua:** presos à régua, para anotações globais de estrutura.
- **Marcadores de clipe:** se a agulha estiver sobre um clipe de vídeo (em V1 ou V2), o marcador fica preso ao clipe e acompanha o vídeo se ele for movido.
- **Edição rápida pelo teclado.** `M` abre um cartão compacto no canto inferior direito. O vídeo **continua tocando** enquanto você digita:
  1. Digite o nome do marcador.
  2. `Tab` vai para a Descrição e `Tab` de novo para a Cor.
  3. `Enter` ou `Esc` salva e fecha.
  4. `M` outra vez salva o atual e abre um novo na posição da agulha.
- **Seleção múltipla.** `Shift+clique` seleciona vários marcadores (borda branca brilhante); `Delete` ou `Backspace` apaga todos de uma vez.
- **Navegação.** `Shift+M` salta para o próximo marcador e `Alt+M` volta ao anterior.

### 5.13 Pontos de entrada e saída (In/Out), loop, lift e extract

- **Marcar intervalos.** `I` marca a entrada (In) e `O` a saída (Out), na timeline ou no Source. `Alt+X` limpa as duas marcações.
- **Navegar.** `Shift+I` leva a agulha ao ponto In e `Shift+O` ao Out.
- **Loop contínuo (`Ctrl+L`).** Ao chegar no Out, o player volta ao In: ideal para refinar transições e diálogos.
- **Lift (`;`).** Remove o trecho In–Out das pistas ativas deixando um gap, sem deslocar o resto.
- **Extract (`'`).** Remove o trecho In–Out e fecha o espaço com ripple nas pistas com Sync Lock.
- **Agulha e marcadores.** A agulha tem prioridade de clique no topo da régua, mesmo sobre marcadores In/Out. O cursor muda conforme o alvo: vermelho para a agulha, ciano para o ponto In, rosa para o ponto Out, e um cursor bidirecional para deslocar todo o intervalo mantendo a duração (segure `Alt` ou `Shift`).

### 5.14 Zoom até o nível de quadro e zoom to fit

- O zoom horizontal vai de uma visão ampla de sequências longas até o **quadro individual**. No zoom máximo, a régua mostra os quadros numerados, inclusive em taxas fracionárias como 23,976 e 59,94 fps.
- **Ajustar a sequência na tela (zoom to fit).** `\` ou `Shift+Z`, ou o botão de zoom to fit na régua. Um segundo acionamento restaura o zoom e a rolagem anteriores.
- **Zoom padrão.** `Ctrl+1` restaura o zoom de trabalho padrão no perfil CapIAu.
- **Mover pela timeline.** `H`, a barra de `Espaço` pressionada ou o botão do meio do mouse ativam a ferramenta Mão (arrastar para navegar).
- **Roda do mouse sobre a régua** aplica zoom centrado no cursor, sem teclas modificadoras.

### 5.15 Miniaturas nas pistas

Para equilibrar visual e desempenho em sequências densas, há três modos de miniatura de vídeo, escolhidos no botão de opções de visualização da timeline:

1. **Rolo de filme (filmstrip):** miniaturas repetidas ao longo do clipe, em intervalo proporcional ao zoom.
2. **Só o início:** uma miniatura na borda esquerda, deixando a pista limpa.
3. **Nenhuma:** sem miniaturas, deixando a máquina livre para formas de onda e edição ágil.

As miniaturas mantêm a proporção real (16:9, 9:16 ou 1:1) sem cortes. O menu de opções se abre para cima automaticamente quando a timeline está na base da tela.

### 5.16 Altura das pistas

- **Uma pista:** `Shift` + roda do mouse sobre o cabeçalho da pista (altura de 22 a 240 px).
- **Todas as pistas:** `Shift` + roda sobre a área dos clipes ou a régua, ou `Numpad +` e `Numpad -`.
- Também é possível arrastar a borda inferior do cabeçalho de uma pista.

### 5.17 Montagem de 3 e 4 pontos e canais de destino

Leve trechos do Source Player (marcados com In/Out) direto para a agulha da timeline:

- **Insert (`,`):** divide os clipes sob a agulha e insere o trecho, empurrando os seguintes nas pistas com Sync Lock. A agulha avança até o fim do trecho inserido, pronta para o próximo.
- **Overwrite (`.`):** substitui o trecho da timeline, a partir da agulha, pela duração do In–Out do Source, sem alterar a duração total.
- **Canais de destino (`Ctrl+Alt+A`):** alterna entre `AV` (vídeo e áudio vinculados), `V` (só vídeo, ideal para B-rolls) e `A` (só áudio, ideal para narração e depoimentos em off; fotos são protegidas no modo áudio). Há também um botão no Source Player.
- **Desfazer e refazer** (`Ctrl+Z`, `Ctrl+Y`) restauram os clipes e a posição exata da agulha.

### 5.18 Localizar o quadro original (Match Frame e Reverse Match Frame)

- **Match Frame (`Alt+F`).** Com a agulha sobre um clipe da timeline, abre o Source Player no mesmo instante da mídia original, mostrando no controle deslizante os limites do corte (para ver sobras e handles). Se há mais de uma pista sob a agulha, vale a pista selecionada; sem seleção, a de vídeo mais alta visível (V2 antes de V1, depois A2 e A1). O foco passa para o Source.
- **Reverse Match Frame (`Shift+F`).** A partir de qualquer ponto do Source, localiza onde aquele quadro foi usado na timeline. Se a mídia foi usada em vários cortes, começa pela ocorrência mais próxima da agulha e, a cada novo `Shift+F`, cicla pelas demais (vídeo e áudio vinculados contam como uma ocorrência só).
  - Durante a navegação aparece um mini painel no Source (ex.: `2 / 3 · V1`) com botões de anterior e próximo.
  - O botão de reverse match mostra um selo com o total de usos e abre uma lista; ela fica aberta enquanto o mouse estiver sobre ela.
  - A agulha salta para o ponto, o clipe é selecionado e pulsa em ciano. Se o quadro não está na timeline, um aviso (toast) informa.

### 5.19 Velocidade do clipe, reprodução reversa e preenchimento de lacunas

- **Diálogo de velocidade e duração (`Ctrl+R`).** Com um clipe selecionado, pressione `Ctrl+R` (ou botão direito › **Velocidade e Duração...**). A janela é arrastável e a barra de `Espaço` continua controlando o Play/Pause do Program Player, para você testar sem fechar o diálogo.
- **Conversão em ambos os sentidos.** Digite a velocidade em porcentagem (`50%`, `200%`) ou a duração desejada em timecode ou quadros, e o outro valor é recalculado. Duplo clique no campo de porcentagem volta a 100%.
- **Deslocar posteriores (ripple) × manter duração.** No primeiro modo, os cortes seguintes avançam ou recuam; no segundo, a velocidade muda sem alterar o espaço ocupado.
- **Reverso.** Marque **Inverter Reprodução** ou digite valores negativos. O clipe toca de trás para frente e o selo de velocidade fica vermelho (ex.: `-100%`).
- **Fit to Gap (`Ctrl+Alt+R`).** Ajusta a velocidade do clipe selecionado para preencher exatamente a lacuna vizinha, sem empurrar a montagem. No botão direito, ao lado de gaps: **Preencher Lacunas (Ambos)**, **Preencher Lacuna à Frente** e **Preencher Lacuna Atrás**.

### 5.20 Rate Stretch: velocidade arrastando a borda

Altere a velocidade de forma tátil, diretamente na timeline:

- **Ferramenta:** `Shift+R` ou `X` (perfil CapIAu), ou o botão na barra vertical de ferramentas. `V` volta à seleção.
- **Durante o arraste**, uma dica flutuante mostra a velocidade (de 10% a 1000%), o multiplicador (ex.: `0.50x`) e a nova duração.
- **Esticar** a borda deixa o clipe mais lento; **comprimir** o deixa mais rápido. O arraste respeita o snapping e as barreiras de gaps ou do fim da mídia.
- **Áudio e vídeo vinculados** são esticados juntos, com correção de tom (pitch) no áudio. Com `Alt` pressionado, só a pista clicada é esticada.
- `Esc` durante o arraste cancela e restaura o clipe.

### 5.21 Congelar quadro (Freeze Frame)

Cria um quadro congelado a partir de qualquer instante do vídeo:

- **Como acionar:** posicione a agulha e pressione `Ctrl+Shift+F`, clique no botão de congelar quadro ou escolha **Congelar Quadro** no menu de contexto do clipe.
- O quadro congelado pode ser **esticado livremente** na timeline, sem limite da duração do arquivo original.
- Funciona em modo **ripple** (abre espaço) ou **overwrite** (substitui o trecho).
- A pista de áudio pareada recebe um gap silencioso da mesma duração. Na timeline, o clipe ganha visual ciano-gelo e miniaturas fixas.

### 5.22 Subclipes virtuais

Subclipes recortam trechos de arquivos longos sem duplicar mídia nem gerar novos proxies:

- **Criar:** no Source Player, marque In (`I`) e Out (`O`) e pressione `Ctrl+U`, ou clique no botão de tesoura.
- Um diálogo mostra os timecodes e a duração, e oferece **sugestões de nome** baseadas na decupagem da IA ou na transcrição daquele trecho.
- Os limites do subclipe são firmes: na timeline, o trim não passa do intervalo que você definiu.
- Na biblioteca o subclipe ganha o selo `SUB` e o hover mostra só o intervalo In–Out. Na timeline, o título recebe o prefixo `✂`.

### 5.23 Substituição de clipe (Replace Edit)

Troque a mídia de um clipe da timeline sem perder o trabalho de montagem:

- **Alt + arrastar:** solte uma mídia da biblioteca ou do Source sobre um clipe segurando `Alt`; o destaque `[REPLACE]` aparece e, ao soltar, a mídia é trocada.
- **Atalho:** selecione o clipe, escolha o quadro no Source (ou marque o In) e pressione `Ctrl+Shift+R`.
- Ficam inalterados: posição, duração, velocidade, ligação áudio/vídeo, cor e enquadramento (inclusive Ken Burns).

### 5.24 Entrada numérica de timecode

Os displays de timecode do Source, do Program e da timeline aceitam digitação direta. Clique neles ou use `Ctrl+G`:

| Digite | Efeito |
|---|---|
| `+50`, `-24` | Avança ou recua 50 ou 24 quadros a partir da agulha |
| `+2s`, `-1.5s` | Avança ou recua em segundos |
| `1.`, `10.`, `1..` | Salta 1 segundo, 10 segundos, 1 minuto |
| `1200`, `100`, `50` | Vai a `00:00:12:00`, `00:00:01:00` e ao quadro 50 |
| `HH:MM:SS:FF` | Timecode absoluto, com ou sem separadores |

Cada salto entra no histórico e pode ser desfeito com `Ctrl+Z`.

### 5.25 Rolagem automática que segue a agulha

Mantém a agulha sempre visível durante a reprodução. Ative com `Ctrl+Alt+F` ou pelo botão com indicador ciano na barra de ferramentas.

- **Modo página:** ao chegar perto da borda direita, a timeline avança uma tela inteira (também em reprodução reversa).
- **Modo suave:** a visualização acompanha a agulha continuamente.
- **Âncora ajustável (30% a 70%):** no menu de opções de visualização, escolha se a agulha corre mais à esquerda, no centro ou mais à direita.
- A configuração é lembrada entre sessões.

### 5.26 Indicadores de sincronia A/V e ressincronização

Quando vídeo e áudio vinculados saem de sincronia (por exemplo, após trims de J-cut ou L-cut), selos discretos nas bordas dos clipes mostram o descompasso em quadros (ex.: `+2f`, `-5f`). Clique com o botão direito no clipe ou no selo:

- **Mover para Sincronia:** desloca o clipe na timeline para realinhar com o par.
- **Deslizar Conteúdo (Slip) para Sincronia:** compensa dentro da própria mídia, sem mover o clipe nem abrir lacunas.

O ripple delete também protege os pares vinculados: se o vídeo sofre uma extração, o áudio associado acompanha na mesma medida, evitando descompassos de lábio.

### 5.27 Ferramentas Rolling, Slip e Slide

Além da seleção e da lâmina (`C` corta uma pista; `Shift+C` corta todas), três ferramentas de ajuste fino mexem em emendas sem alterar a duração total da montagem. Escolha pela barra vertical de ferramentas da timeline ou pelo teclado (perfil CapIAu):

| Ferramenta | Atalho | O que faz |
|---|---|---|
| **Rolling Edit** | `Shift+N` | Move a emenda entre dois clipes: um ganha o que o outro perde, com o tempo total constante. |
| **Slip** | `Y` | Desliza o conteúdo dentro do clipe (muda qual trecho da mídia aparece) sem mover o clipe nem alterar sua duração. |
| **Slide** | `U` | Desliza o clipe entre os vizinhos, que se ajustam para compensar. |

> **Atenção:** `U` seleciona a ferramenta Slide; ela não desvincula áudio e vídeo (para isso, veja 5.8). `V` volta à ferramenta de seleção.

---

## 6. Tratamento de áudio: diagnóstico, presets e comparação A/B

Editar vídeo e editar áudio são ofícios diferentes. Esta seção existe para você não precisar do segundo: o programa **mede** o áudio do clipe e diz o que fazer, em vez de esperar que você reconheça o problema de ouvido.

### 6.1 As duas naturezas de ajuste

O painel **Ajustes** separa duas coisas que se comportam de formas opostas:

- **Ao vivo:** Equalizador e Dinâmica. Mudam na hora, enquanto o clipe toca, e você desfaz quando quiser. **Não geram arquivo.** É o lugar de experimentar.
- **Renderizado:** a seção Tratamento. Gera um arquivo novo, demora e entra em uma fila. O arquivo derivado fica em `data/audio_tratado/` e **o seu arquivo original nunca é tocado**: o clipe passa a apontar para o tratado. Se você reaplicar a mesma receita, o resultado volta instantaneamente.

### 6.2 Passo 1: diagnosticar

1. Clique em um clipe de áudio na timeline (ou em um vídeo com áudio vinculado).
2. Na seção **Diagnóstico de Áudio**, clique em **Analisar**. Leva cerca de 3 segundos para um clipe de um minuto.
3. Leia as cinco linhas. Cada uma vem com um selo: **verde** está bom, **âmbar** pede atenção, **vermelho** é problema sério.

| Linha | O que quer dizer | Quando incomoda |
|---|---|---|
| Loudness | Volume médio do trecho, em [LUFS](https://github.com/fernangcortes/capiau-talho-v03/wiki/18.-Glossario-Visual-e-Terminologia) | Longe do alvo de −16 LUFS, o clipe soa mais alto ou mais baixo que os vizinhos |
| Pico real | O instante mais alto | Acima de 0 dBTP é distorção; baixar o volume depois não desfaz |
| Clipping | Fração de amostras no limite | Quase nunca acende; confie no Pico real |
| Ruído | Som de fundo entre as falas | Acima de −35 dB o chiado aparece na montagem |
| Dinâmica | Diferença entre o alto e o baixo | LRA abaixo de 5 já está esmagado: **não comprima de novo** |

4. Se houver o ícone **(i)** ao lado de uma linha, clique nele: abre uma explicação com um bloco **Na prática** dizendo o que fazer.
5. Ao final aparece a **sugestão de preset**, que sai da medição, não de chute.

### 6.3 Passo 2: ver onde está o problema

Depois de analisar, o clipe ganha uma **faixa fina na base** com marcas vermelhas onde o som estourou, e a seção lista os **piores momentos com timecode**. Clicar em um momento leva a agulha até lá para você ouvir.

> **Dica:** quando o material estoura de ponta a ponta (captação ruim de verdade), a faixa informa melhor que a lista. Em material com estouro ocasional (uma pancada, uma risada), a lista é o atalho.

### 6.4 Passo 3: escolher o preset

| Preset | Para quê | Espera (entrevista de 22 min) |
|---|---|---|
| **Só entrega** | Áudio já limpo, só falta o volume certo | cerca de 43 s |
| **Resgate de captação estourada** | O caso comum: distorcido e barulhento | cerca de 43 s |
| **Ambiência preservada** | Rua, feira, som direto: limpar sem matar o ambiente | cerca de 43 s |
| **Prévia rápida** | Só normalizar para ouvir | cerca de 43 s |
| **Resgate com IA (lento)** | Quando o filtro clássico deixou artefato | cerca de 16 min |
| **Voz limpa com IA (lento)** | Boa captação em que só o chiado incomoda | cerca de 16 min |

Os presets clássicos usam cadeias de filtros do FFmpeg (remoção de ruído contínuo, de-click, equalização de voz e limitador suave). Os dois de IA usam uma rede neural de denoise (DPDFNet) rodando no seu computador: limpam bem melhor (o piso de ruído desce cerca de 13 dB a mais), mas são **cerca de 45 vezes mais lentos**. Os tempos acima são de referência e variam com a máquina. O modelo de denoise precisa ser baixado uma vez (veja a [Instalação e Configuração](https://github.com/fernangcortes/capiau-talho-v03/wiki/02.-Instalacao-e-Configuracao)) e o programa avisa se estiver faltando.

### 6.5 Passo 4: prever antes de comprometer

**Sempre clique em "Prever 15 s" primeiro.** Ele trata só 15 segundos a partir do ponto de entrada do clipe:

- com preset clássico, responde em cerca de 1 segundo;
- com preset de IA, em cerca de 10 segundos, contra os 16 minutos do clipe inteiro.

Ouça o A/B (**Tratado** × **Original**) e só então decida. É a diferença entre descobrir em 10 segundos que a receita não serve, ou em 16 minutos.

### 6.6 Passo 5: aplicar, comparar e descartar

1. Clique em **Aplicar**. O tratamento entra em uma fila e o painel mostra o progresso; você continua montando.
2. Quando ficar pronto, a seção **Resultado** mostra os números de antes e depois lado a lado.
3. Alterne **Tratado** × **Original** para comparar de ouvido.
4. **Descartar** remove o tratamento do clipe. O arquivo continua no disco: se você reaplicar a mesma receita, ele volta na hora.

### 6.7 Ajustes ao vivo (Equalizador e Dinâmica)

Você mexe **durante a reprodução** e ouve na hora:

- **Corte de graves (HPF):** 80 Hz elimina ruído de mesa, vento e pisada sem tocar na voz. É o primeiro a tentar.
- **Graves / Médios / Agudos:** correção de timbre.
- **Gate:** silencia o fundo quando ninguém fala.
- **Compressor** e **ganho de compensação:** emparelham os picos da fala.

Cada seção tem o olho (**bypass**, para comparar com e sem) e a seta (**reset**). Os valores ficam salvos no clipe e vão junto na exportação. Como EQ e compressor **não atravessam XML (FCPXML) nem EDL**, eles são descritos em um arquivo `.txt` gerado ao lado do export, para quem faz a mixagem reproduzir na estação de áudio.

### 6.8 Restauração avançada com Auphonic (nuvem)

Com a chave informada no campo **Chave Auphonic**, em **Configurações › Modelos & Chaves** (ou na variável `AUPHONIC_API_KEY` do `.env`; o painel tem prioridade sobre o `.env`), o motor **Auphonic** fica disponível. Ele faz o que o processamento local não faz: remoção de reverberação, realce automático de voz, nivelamento dinâmico, AutoEQ e limpeza preservando a ambiência.

O plano gratuito oferece **2 horas por mês**. O painel mostra quanto resta e avisa quando está acabando. Há duas proteções: sem cota suficiente o programa recusa **antes** de enviar qualquer coisa, e a prévia de 15 s nunca vai para a nuvem (gastaria cota para responder o que o motor local responde de graça).

> **Dica:** não mande a entrevista bruta. Mande o trecho que entra no filme. Com o aproveitamento típico de um documentário, as suas horas de bruto viram menos de uma hora de material usado, e isso cabe no mês com folga.

Em **Ajustes da nuvem** você vê o que a medição decidiu campo a campo e pode discordar de qualquer um; só o que você alterar vai como manual. Uma coisa não é negociável nem ali: **corte automático de silêncio e de hesitação fica sempre desligado**. Para o guia detalhado do Auphonic, consulte [docs/dev/AUPHONIC_AUDIO_RESTORATION_GUIDE.md](docs/dev/AUPHONIC_AUDIO_RESTORATION_GUIDE.md).

---

## 7. Carrossel de alternativas da IA

Sempre que a IA propõe e insere um vídeo na timeline, ela guarda trechos alternativos parecidos do acervo. Isso permite trocar clipes de forma dinâmica:

1. **Abrir.** Selecione um clipe gerado pela IA (com borda diferenciada) e pressione `Alt+A` no perfil CapIAu.
2. **Modal com prévias.** Aparece um modal com um cartão por alternativa, cada um tocando em loop mudo de 5 segundos o trecho exato recomendado.
3. **Substituir.** Sob a justificativa de cada cartão há dois botões:
   - **Slot fixo:** troca a mídia ajustando In e Out para caber exatamente na mesma duração da timeline.
   - **Ripple:** troca aplicando a duração ideal recomendada do candidato e empurra ou puxa os clipes seguintes da pista.
4. **Desfazer.** Todas as trocas entram no histórico e podem ser revertidas com `Ctrl+Z`.

> **Atenção:** nos perfis Kdenlive, Premiere, Resolve e Final Cut, o carrossel abre com `A`; no perfil CapIAu, `A` pula para o corte anterior, por isso o atalho é `Alt+A`.

---

## 8. Salvando, auto-salvamento, importação e logs

### 8.1 Auto-salvamento

Você não precisa salvar a cada modificação. Um mecanismo em segundo plano grava a cada segundo, no armazenamento do seu navegador:

- **Resiliência.** Se você fechar a aba ou atualizar a página (`F5`), a timeline inteira (cortes, pistas, ghosts) e as preferências de visualização (zoom, rolagem, agulha, seleções) são restauradas.
- **Histórico retido.** A pilha de desfazer e refazer também volta.
- **Por projeto.** Cada projeto tem o seu auto-salvamento, sem misturar timelines de trabalhos diferentes.

> **Atenção:** o auto-salvamento fica **no navegador**, não no banco de dados. Limpar os dados do site ou trocar de navegador perde essa cópia. Para uma versão fixa, salve a sequência (8.2). A exportação de vídeo também usa a versão salva, não a da tela.

### 8.2 Salvamento permanente e exportação

1. Dê um nome à sequência no campo de texto (ex.: *Montagem Inicial*).
2. Clique em **Salvar** para gravar a timeline no banco de dados.
3. Escolha o formato de saída no seletor: XML (Premiere, Resolve, FCP), OpenTimelineIO (`.otio`) ou EDL.
4. **Exportar com proxies locais.** Para levar a timeline a outro computador sem carregar discos de mídias pesadas, marque **Usar proxies locais**. O arquivo (ex.: `montagem_proxy.otio`) aponta para os vídeos leves em `data/proxies/`.
5. Clique em **Exportar**. O download começa no navegador e o arquivo está pronto para abrir no seu editor.

> **Vindo do Premiere/Resolve/FCP/Kdenlive:** o Kdenlive abre o `.otio` direto. Veja [docs/usuario/kdenlive_workflow.md](docs/usuario/kdenlive_workflow.md).

### 8.3 Importação de timelines (o caminho inverso)

O CapIAu também importa timelines criadas em editores externos (Kdenlive, Premiere, Resolve, Final Cut) ou exportadas por ele mesmo:

1. Na barra de ferramentas da timeline, clique em **Importar Timeline** (ao lado do Exportar).
2. Escolha o arquivo: `.otio`, `.xml` ou `.edl`. O nome da nova timeline vem do arquivo; ajuste se quiser.
3. Clique em **Importar**. Cada clipe é **religado à mídia já ingerida**, pelo caminho do arquivo (se mudou, o sistema tenta casar pelo nome único). Nada é copiado nem re-ingerido.
4. Se algum arquivo não existir no acervo, o clipe vira um **gap na posição original** e o diálogo lista o que ficou ausente, para você religar depois.
5. Com **Carregar na tela após importar** marcado, a timeline abre direto, com pistas, posições e gaps preservados.

> **Dica:** `.otio` abre sem dependências extras. `.xml` e `.edl` dependem do pacote `opentimelineio` do ambiente do servidor; se o importador reclamar, converta a timeline para `.otio` no editor de origem. Para mais detalhes, veja a [Instalação e Configuração](https://github.com/fernangcortes/capiau-talho-v03/wiki/02.-Instalacao-e-Configuracao).

### 8.4 Painel de logs com IA

Para auditar suas ações, investigar um erro ou gerar relatórios:

1. Abra a aba **Logs** na barra lateral direita (ícone de terminal).
2. Ali o sistema registra ações, chamadas de IA e erros em tempo real.
3. **Assistente de Logs (IA):**
   - **Relatório Humano:** a IA lê os logs e monta uma lista resumida, não técnica, do que você fez na sessão.
   - **Análise Técnica (OR):** aciona o OpenRouter para uma auditoria técnica dos logs, em busca de erros e de melhorias de desempenho.
   - **Copiar e Limpar:** copiam os logs formatados para a área de transferência ou limpam o histórico atual.

---

## 9. Layout e organização avançada

### 9.1 Inspetor de Mídia integrado

O Inspetor de Mídia, no menu lateral esquerdo, serve para decupagens e análises profundas sem popups flutuantes.

- **Abrir.** Com uma mídia selecionada na biblioteca (ou com o Source Player em foco), pressione `A` ou clique no cartão ou item da lista. A barra direita se oculta, a esquerda se expande e o **Source Player** é maximizado para a inspeção.
- **Abas:**
  - **Índice:** resumos da IA e capítulos navegáveis.
  - **Legenda:** transcrição por falante, com menu para trocar falantes ou criar novos e função para dividir diálogos na agulha.
  - **Temas:** adicione e remova temas diretamente e filtre trechos com In/Out capturados em tempo real.
  - **Rostos:** galeria de rostos detectados com marcações de tempo e campos para rotular e desambiguar as pessoas.
  - **IA:** gatilhos rápidos para transcrição, visão e rostos de uma mídia individual.
- **Fechar.** `A` outra vez, `Esc` ou o botão **Voltar** restauram a biblioteca como estava (aba anterior, barra direita reaberta e o clipe ativo em foco).

### 9.2 Operação dos players

- **Play / Pause.** Clique simples na área de vídeo de qualquer player.
- **Maximizar / Minimizar.** Clique duplo na área de vídeo expande o player; outro clique duplo restaura a visão dupla.
- **Trocar o player maximizado.** Quando um dos players está maximizado, o ícone de troca (⇄) no cabeçalho alterna entre o Source e o Program maximizados. O atalho `Numpad *` (perfil CapIAu) também alterna o foco entre os dois monitores.
- **Program automático.** Se o Source está maximizado e você clica em um clipe da timeline, o Program é aberto e maximizado sozinho, para você ver o resultado do corte.

#### Margens de segurança e máscaras de proporção (Program Player)

O Program Player pode mostrar guias vetoriais por cima da imagem, sem afetar a exportação:

- **Ligar e desligar:** botão de margens de segurança ao lado dos controles do Program Player (tooltip *Margens de Segurança & Guias de Proporção*) ou `Ctrl+Shift+G`.
- **Opções:** clique com o botão direito no botão, ou na seta ao lado dele, para abrir o menu de guias:
  - **Action Safe (90%)** e **Title Safe (80%)**: as áreas seguras para ação e para texto.
  - **Cruz central**: marca o centro do quadro.
  - **Máscaras de proporção:** 16:9, 9:16, 1:1 e 2.39:1. A máscara escurece o que ficaria fora daquele formato, útil para enquadrar já pensando em redes sociais ou em tela de cinema.
- **Trocar a máscara pelo teclado:** `Ctrl+Alt+G` alterna entre as máscaras. Um selo no botão indica a máscara ativa.
- As escolhas são lembradas entre sessões.

> **Dica:** monte em 16:9 e use a máscara 9:16 para conferir se um corte vertical para Reels ou TikTok mantém o rosto dentro da área útil. Para exportar de fato em 9:16, mude a resolução da sequência (seção 10).

### 9.3 Disposição dos monitores e da timeline

- **Monitores:** **lado a lado** (Source à esquerda, Program à direita) ou **empilhados** (Source no topo, Program na base; nesse formato os cabeçalhos e controles aparecem ao passar o mouse, liberando 100% da área de vídeo). Alterne pelo seletor **Monitores** do cabeçalho, pelos botões nos players ou com `Numpad /`.
- **Timeline:**
  - **Entre os menus laterais:** contida na coluna central.
  - **Expandida à esquerda:** passa sob a biblioteca e o inspetor.
  - **Expandida à direita:** passa sob o menu lateral direito.
  - **Faixa de baixo completa:** 100% da largura, o modo "Estúdio" panorâmico.
  - Alterne pelos botões de seta no cabeçalho, pelo modal de workspace ou por `Numpad 1`, `Numpad 2` e `Numpad 3`.
- As duas opções funcionam de forma independente em qualquer workspace e são lembradas.

### 9.4 Workspaces modulares

1. **Modal de configuração.** No cabeçalho, ao lado do seletor de workspaces, o botão de controles deslizantes abre um modal visual. Os cartões mostram a sequência das colunas: **Biblioteca de Mídias**, **Ajustes & Efeitos (Inspetor)**, **Preview & Program (Monitores)** e **Painel Lateral (Transcrição/Áudio/Rostos)**.
2. **Reordenar.** Arraste os cartões ou use os botões ◀ e ▶ (úteis em touchpads). Cada cartão indica a direção de recolhimento: *Dock: Esquerda*, *Centro (Âncora)* ou *Dock: Direita*.
3. **Presets de um clique:**
   - **Padrão:** Biblioteca, Ajustes & Efeitos, Monitores, Painel Lateral.
   - **Inspetor à direita:** Biblioteca, Monitores, Ajustes & Efeitos, Painel Lateral.
   - **Foco em decupagem:** monitores empilhados, com ampla área para biblioteca e metadados.
   - **Foco em montagem:** timeline na faixa de baixo em largura total.
4. **Workspaces personalizadas e slots (1 a 9).** `Ctrl+Alt+Shift+[1-9]` grava o layout atual no slot; `Ctrl+Alt+[1-9]` carrega o layout do slot. No modal de salvamento, o menu **Vincular a Slot Rápido** associa o layout a um número, e os slots aparecem identificados (ex.: `[1] Workspace: Padrão`).
5. **Botões de recolher inteligentes.** Painéis à esquerda do Preview recolhem para a esquerda; os da direita, para a direita. O centro dos monitores se expande para ocupar o espaço, mantendo vídeo e timeline sempre visíveis.
6. **Modo Zen / Cinema (`Numpad 0`).** Oculta o cabeçalho e todas as barras laterais; um novo toque restaura tudo como estava.

### 9.5 Controles da biblioteca

- Os botões de **Modo de Visualização** (lista ou cartões) e o controle de **Zoom** das miniaturas ficam na linha inferior da barra da biblioteca, junto com Expandir Tudo, Recolher Tudo e Abrir Fotos no Player, todos como ícones simples.
- **Zoom com a roda:** passe o mouse sobre a grade, segure `Shift` e gire a roda para aumentar ou reduzir os cartões.

#### Galeria: atalhos de mouse e painel de detalhes

No modo galeria da biblioteca, passar o mouse sobre um cartão já toca uma prévia. Segurando uma tecla enquanto o mouse está sobre o cartão:

- **`Ctrl`:** percorre o vídeo ao mover o mouse (scrubbing).
- **`Alt`:** inspeciona os momentos cruciais do vídeo em sequência (slideshow).
- **`Shift`:** abre um painel flutuante com título, nome do arquivo, metadados, resumo e etiquetas, com os botões **Girar** (`R` gira 90° para a direita e `Shift+R` para a esquerda), **Crucial** (marca um momento crucial, em vídeos) e **Abrir**. O painel também funciona em janelas destacadas.

#### Inserir mídias na timeline

1. **Duplo clique e modificadores:**

   | Gesto | Onde a mídia entra |
   |---|---|
   | Duplo clique | No final da timeline (prefere V1 e ignora pistas ocultas) |
   | `Shift` + duplo clique | Na posição da agulha, que vai para o fim do clipe inserido |
   | `Ctrl` (ou `Cmd`) + duplo clique | No primeiro gap a partir do quadro 0, agulha no início da mídia |
   | `Ctrl+Shift` + duplo clique | No próximo gap à frente da agulha, agulha no início da mídia |
   | `Alt+Shift` + duplo clique | No início da timeline (quadro 0) |
   | `Alt` + duplo clique | Ripple insert: divide os clipes sob a agulha e empurra os seguintes |
   | `Ctrl+Alt` + duplo clique | Sobreposição na pista superior livre (ex.: V2 / B-roll), na agulha |

2. **Botão direito › Adicionar à Timeline.** Mostra as mesmas opções com seus atalhos. Se há um clipe selecionado na timeline, aparece também **Substituir Clipe Selecionado**. Clicar no item principal faz a inserção padrão no final.
3. **Arrastar e soltar.** Arraste qualquer vídeo ou foto para a pista desejada (com `Ctrl` no soltar, vira ripple insert).
4. **Fotos.** Passe o mouse sobre uma miniatura de foto e clique no botão `+` para inserir como still (5 s por padrão) na agulha.

### 9.6 Janelas destacadas em vários monitores

Para ilhas de edição com dois ou mais monitores, qualquer painel (Biblioteca, Ajustes & Efeitos, Painel Lateral, Timeline ou Players) pode ser destacado para uma janela do navegador em outro monitor:

- **Destacar:** botão de destaque no cabeçalho do painel ou `Ctrl+Numpad [2, 4, 5, 6, 7, 9]`. Na janela externa, o botão vira **Reanexar ao Editor Principal**; fechar a janela também devolve o painel ao lugar original.
- **Posição lembrada.** Ao reabrir ou recarregar, a janela destacada volta à posição e ao tamanho anteriores no monitor secundário.
- **Sincronia em tempo real.** Seleção de clipes, reprodução no Source, zoom das miniaturas e alterações de metadados aparecem iguais nas duas janelas. Trocar de workspace ou mover a timeline não fecha nem quebra o painel destacado.
- **Diálogos também acompanham.** As confirmações e campos de nome (ex.: nomear um rosto, confirmar uma exclusão) abrem na janela em que você está trabalhando, inclusive em um painel destacado em outro monitor, e não somem atrás da janela principal.

---

## 10. Configurações da sequência e zoom do preview

### 10.1 Configuração automática no primeiro clipe

Ao colocar o primeiro clipe de **vídeo** em uma timeline totalmente vazia, o sistema lê a resolução e o FPS do arquivo e configura a timeline para coincidir. Fotos não disparam essa configuração, para que a timeline fique nos valores padrão ou nos que você escolher.

### 10.2 Painel de configurações da sequência

Com nenhum clipe selecionado (ou ao abrir a aba **Ajustes** sem seleção), o painel lateral direito mostra as **Configurações da Sequência**:

- **Presets de resolução:** 1920×1080 (16:9), 1080×1920 (9:16 vertical), 3840×2160 (4K), 1080×1080 (1:1) ou *Personalizado*.
- **Dimensões personalizadas:** em *Personalizado*, largura e altura são editáveis e a proporção é calculada na hora.
- **FPS:** de 23,976 a 60.
- **Aviso e reescalagem.** Se você muda o FPS de uma timeline que já tem clipes, o sistema avisa e recalcula as posições para **preservar a duração em segundos**. A alteração é um único passo no histórico e pode ser desfeita com `Ctrl+Z`.

### 10.3 Acesso rápido

Abra as configurações pelo botão de **engrenagem** no cabeçalho do Program Player ou pela barra de ferramentas lateral da timeline. As propriedades são lembradas no auto-salvamento e gravadas no banco ao salvar a timeline.

### 10.4 Zoom de visualização do Program Player

Ao lado do seletor de resolução há um seletor de zoom: **Fit, 25%, 50%, 75% e 100%**.

- **Fit:** ajusta a imagem ao tamanho disponível, para ver a sequência inteira.
- **Percentuais fixos:** mostram a sequência em escala estrita. O que passar do enquadramento é escurecido, o que facilita alinhar detalhes finos.

---

## 11. Viewport estável, alças de transformação e recorte (Crop)

### 11.1 Viewport estável e máscara de transbordo

A área de visualização do Program Player mantém a **proporção real da sequência** (ex.: 16:9 ou 9:16), sem ser afetada pelo tamanho da janela do navegador ou pelas barras divisórias.

Tudo o que ultrapassa o enquadramento (um clipe ampliado ou deslocado) continua visível além das bordas pontilhadas, mas escurecido por uma máscara de 70%. Assim você vê o transbordo e sabe exatamente o que será cortado na exportação.

### 11.2 Alças de transformação

Com um clipe de vídeo ou foto selecionado e a agulha sobre ele, uma caixa ciano aparece ao redor da imagem no Program Player. A caixa acompanha o conteúdo visível, descontando faixas pretas (letterbox).

- **Mover:** arraste o interior da caixa. Os valores X e Y são atualizados.
- **Escalar:** arraste os quadrados brancos dos cantos para ampliar ou reduzir uniformemente.
- **Rotacionar:** arraste a alça no topo da caixa.
- **Histórico e sliders.** Ao soltar, o gesto vira um passo único no histórico e os sliders da aba **Ajustes** mostram os valores finais. `Ctrl+Z` desfaz o arraste inteiro.
- Um clique curto, sem arrastar, continua funcionando como Play/Pause.

### 11.3 Recorte (Crop)

Na aba **Ajustes**, a seção **Recorte (Crop)** (abaixo das transformações) ajusta as bordas **Esquerda**, **Direita**, **Topo** e **Base**, de 0% a 90%.

- O recorte é relativo à imagem útil: 10% na esquerda corta 10% do conteúdo, não da faixa preta.
- Ele acompanha escala, rotação e posição do clipe.
- A rolagem do painel é preservada enquanto você mexe nos sliders.

### 11.4 Reset com duplo clique

Dê **duplo clique** no nome de um parâmetro ou no seu slider (Posição X/Y, Rotação, Escala, Crop, Volume, Fades) para voltar ao valor padrão (posição 0, escala 100%, rotação 0°, crop 0%, volume 100%). A alteração pode ser desfeita com `Ctrl+Z`.

> **Dica:** as margens de segurança e as máscaras de proporção ([9.2](#92-operação-dos-players)) ajudam a conferir o enquadramento enquanto você ajusta posição e escala.

---

## 12. Seleção de modelos de IA e gestão de tarefas

### 12.1 Modelos de visão e de texto

Em **Configurações**, você escolhe os modelos usados pela IA:

- **Visão** (descrição de quadros do acervo). O padrão é **Gemini 2.5 Flash**. A lista inclui também Gemini 3.8 Flash, Gemini 3.1 Pro (prévia), Gemini 3.1 Flash Lite, Perceptron MK1 e **Nemotron 3 Nano Omni (grátis)**.
- **Texto e agente** (chat, temas, relatórios). O padrão é **DeepSeek V4.1 Flash**, com opções como DeepSeek V4 Pro, Gemini, Claude Sonnet 5.5 e GPT-5.5 (a lista exata aparece nas Configurações).
- **Modelo reserva.** Se o modelo de visão escolhido falhar (cota, instabilidade de rede), o sistema tenta automaticamente o modelo reserva, que por padrão é o Nemotron grátis.
- **Proteção contra sobrescrita.** Se todas as chamadas falharem, as descrições e categorias boas já salvas são preservadas.
- **Limite de saída.** As chamadas usam um teto de tokens para evitar que o provedor reserve créditos além do necessário e responda com erro de saldo insuficiente (402).

> **Atenção:** os modelos gratuitos têm limites do provedor (o OpenRouter limita o uso diário de modelos gratuitos e pode demorar a responder). Para lotes grandes, prefira o modelo pago padrão.

### 12.2 Gerenciador de tarefas de miniaturas

No painel de tarefas e status da mídia, você acompanha a geração das miniaturas e pode **Pausar**, **Cancelar**, **Remover** e **Sincronizar** para liberar recursos do computador quando precisar.

---

## 13. Hardware, aceleração por GPU e fallback automático

A aba **Hardware & GPU** do Painel de Configurações (engrenagem no cabeçalho) permite aproveitar sua placa gráfica (Intel QuickSync, AMD, Nvidia) e protege o computador com **fallback automático para CPU**.

### 13.1 Opções da aba

1. **Codificador de vídeo (proxies e exportação):**
   - **Automático** (padrão recomendado): detecta o melhor acelerador instalado e usa a CPU se não houver.
   - **Intel QuickSync (`h264_qsv`)**, **AMD AMF (`h264_amf`)**, **Nvidia NVENC (`h264_nvenc`)**.
   - **Software CPU (`libx264`)**: compatibilidade universal.
2. **Decodificação de vídeo por hardware:** o modo automático usa a GPU para descompactar vídeos 1080p e 4K na extração de miniaturas e na navegação, reduzindo calor e uso da CPU. Há opções específicas (Direct3D 11, DirectX 9, CUDA) e **Desativado** (só CPU).
3. **Aceleração OpenCL no OpenCV:** acelera operações em fotos (filtros, realce de contraste e redimensionamento) sem consumir memória de vídeo dedicada.
4. **Dispositivo para os modelos de busca (CLIP e embeddings):** o modo automático mantém esses modelos leves, poupando a memória da placa para a codificação de vídeo. DirectML e CUDA ficam disponíveis para placas com mais memória.

### 13.2 Fallback automático e silencioso

Se a placa atingir o limite de codificações simultâneas, ou rejeitar um arquivo de perfil incomum, o sistema muda **na hora para a CPU** sem interromper a fila e sem exibir erros, garantindo que todos os proxies e miniaturas sejam gerados.

### 13.3 Dicas dentro do painel

Passe o mouse sobre o ícone **ⓘ** ao lado de cada opção para ver uma explicação técnica mais detalhada.

---

## 14. Atalhos de teclado e perfis NLE

O CapIAu-Talho tem um sistema completo de atalhos, com **perfis** que reproduzem a ergonomia de outros editores:

| Perfil | Pensado para |
|---|---|
| **CapIAu Padrão** | Híbrido moderno, com a suíte QWER/ASDF para a mão esquerda |
| **Kdenlive** | Quem vem do editor open source |
| **Adobe Premiere Pro** | Quem vem do ecossistema Adobe |
| **DaVinci Resolve** | Quem vem da pós-produção Blackmagic |
| **Apple Final Cut Pro** | Quem vem do ecossistema Apple |
| **Personalizado** | Mapeamento livre, com gravador de teclas, detector de conflitos e exportação e importação em JSON |

Para trocar de perfil, abra o **Guia de Atalhos** (ícone de teclado na barra da timeline) e escolha em **Perfil**. Este manual cita os atalhos do perfil **CapIAu Padrão**; nos outros perfis, algumas teclas mudam.

### Regra de contexto

Um mesmo atalho pode agir de forma diferente conforme o contexto. É intencional: o programa decide pelo que está acontecendo no momento. O que conta é:

- **o painel em foco** (timeline, Source Player, Program Player, biblioteca);
- **a ferramenta ativa** na barra de ferramentas;
- **o que está sob o mouse** (hover);
- **se há uma sugestão ativa** da IA (ghost clip selecionado).

Exemplos: `A` abre o Inspetor de Mídia na biblioteca e pula para o corte anterior na timeline; `Delete` apaga um clipe normal, mas rejeita um ghost clip selecionado; `Ctrl+L` liga o loop de reprodução e, em certos contextos, também desvincula áudio e vídeo (para desvincular, prefira `Ctrl+Shift+U`).

### Teclado visual e teste ao vivo

O Guia de Atalhos traz um teclado esquemático em tamanho real:

- Passar o mouse sobre uma tecla destaca o comando correspondente na lista, e vice-versa.
- Botões alternam as camadas **Padrão**, **+ Shift**, **+ Ctrl** e **+ Alt**, também ao segurar os modificadores no teclado físico.
- **Teste ao vivo:** com o guia aberto, digite qualquer atalho para ver a tecla acender e o nome e a descrição do comando aparecerem no rodapé.
- Modo tela cheia para visualização imersiva.

### Lista completa de atalhos

- Lista completa e atualizada, gerada a partir do mapa de teclas do programa: [docs/usuario/shortcuts.md](docs/usuario/shortcuts.md).
- Cartões imprimíveis por perfil (para deixar ao lado do teclado): pasta [docs/usuario/atalhos/](docs/usuario/atalhos/).
- Versão da wiki: [Guia Completo de Atalhos](https://github.com/fernangcortes/capiau-talho-v03/wiki/14.-Guia-Completo-de-Atalhos).

<!-- GERADO:ATALHOS:INICIO -->

#### Perfil CapIAu Padrão

> Alguns atalhos aparecem em mais de uma ação neste perfil. Isso é intencional: a ação executada depende do contexto (painel em foco, ferramenta ativa, elemento sob o mouse, sugestão ou clipe fantasma ativo). A coluna de observação indica com quais ações o atalho é compartilhado.

##### 1. Reprodução & Navegação

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

##### 2. Ferramentas & Modos

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

##### 3. Edição, Cortes & Trims

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

##### 4. Marcadores

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `M` | Adicionar / Editar Marcador | Cria um novo marcador ou abre o popover de edição rápida no playhead |
| `Shift + M` | Pular para o Próximo Marcador | Avança a agulha de reprodução até o marcador seguinte na timeline |
| `Alt + M` | Pular para o Marcador Anterior | Recua a agulha de reprodução até o marcador anterior na timeline |
| `Ctrl + Shift + K` ou `Ctrl + Shift + M` | Alternar Momento Crucial (Player / Galeria) | Marca ou desmarca o quadro atual como Momento Crucial para reprodução rápida em hover |

##### 5. Assistência de IA & Tomadas

| Atalho | Ação | Contexto/observação |
| :--- | :--- | :--- |
| `Ctrl + Alt + B` | Alternar Detecção Facial no Source | Exibe ou oculta a camada visual de caixas de detecção facial e grounding no Monitor de Origem (Source) |
| `Alt + A` | Alternar Tomadas / Alternativas de IA | Abre o seletor de tomadas alternativas em clipes gerados por IA / Inspetor |
| `Enter` ou `Y` | Aceitar Sugestão de IA | Aprova a sugestão da faixa fantasma de IA, tornando-a clipe real na trilha<br>**Atalho compartilhado, depende do contexto:** Renderizar Efeitos In para Out (Cache NLE) (Enter); Deslizar Conteúdo Interno (Slip Tool) (Y). |
| `Del` ou `N` | Rejeitar Sugestão de IA | Descarta e remove a sugestão fantasma da timeline<br>**Atalho compartilhado, depende do contexto:** Lift Delete (Apagar Clipe) (Del); Alternar Snapping Magnético (N). |

##### 6. Canvas, Zoom & Histórico

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

##### 7. Layout & Workspace (Numpad)

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

As tabelas dos demais perfis (Adobe Premiere Pro, DaVinci Resolve, Apple Final Cut Pro, Kdenlive) ficam em [docs/usuario/shortcuts.md](https://github.com/fernangcortes/capiau-talho-v03/blob/main/docs/usuario/shortcuts.md).

<!-- GERADO:ATALHOS:FIM -->

---

## 15. Formas de onda (waveforms)

A forma de onda desenhada nos clipes de áudio **não é enfeite**: são os picos reais do arquivo. Isso deixa você achar a respiração antes da fala, o estalo do microfone e o ponto exato onde a frase começa, sem precisar dar play.

### Como as ondas são geradas

O áudio é decodificado e o programa guarda, para cada 10 ms, o menor e o maior valor daquele trecho. O resultado fica em `data/waveforms/` e é gerado uma única vez, sendo reaproveitado depois.

**Botão "Ondas"** (verde, na barra da biblioteca): gera as formas de onda de **todos** os vídeos do projeto de uma vez. Vídeos sem trilha de áudio são pulados sem erro.

### Por que isso importa para a edição

Com a timeline afastada, cada pixel da tela representa muito áudio. Em vez de tirar uma média (que apagaria um estalo curto no meio de muitos trechos baixos), a onda sempre mostra os extremos de cada trecho. Resultado: você enxerga um defeito com a timeline inteira na tela, dá zoom **no lugar certo** e conserta.

### Desempenho

As ondas aparecem de forma instantânea mesmo em acervos grandes: ficam em cache no disco e na memória, são pré-carregadas para os clipes da timeline que você abre e cada onda é pedida só uma vez, mesmo que o mesmo vídeo apareça em vários clipes.

---

## 16. Exportar vídeo: render da timeline em MP4

O botão de claquete na barra da timeline abre o painel de exportação. Ele transforma a sua montagem em um arquivo, com o compromisso de que o resultado seja **igual ao que o monitor de Programa mostra** e de nunca degradar nada em silêncio.

### Antes de exportar: salve

> **Atenção:** a exportação usa a versão **salva** no banco, não a que está na tela.

O auto-salvamento grava no navegador, não no banco. Quem ajusta cor ou enquadramento e exporta sem salvar renderiza a versão **anterior**. O painel compara as duas e, se diferirem, mostra uma faixa âmbar dizendo exatamente o que muda, com o botão **Salvar e usar esta versão**.

### O painel, de cima para baixo

1. **Timeline:** qual versão salva exportar (a mais recente vem selecionada).
2. **Preset:** `Master 1080p`, `YouTube`, `Reels/TikTok 9:16`, `WhatsApp leve`.
3. **Avançado:** resolução, fps, container, codec, qualidade (CRF) e bitrate de áudio. Campo em branco significa "usa o do preset".
4. **Faixa:** a timeline inteira ou só o intervalo marcado In–Out.
5. **Usar Proxies Locais:** renderiza usando só os proxies de `data/proxies/` (ideal para rascunho e revisão, ou quando o disco original está desconectado). O nome sugerido recebe o sufixo `_proxy.mp4`.
6. **Incluir no render:** por categoria (cor, transições, movimento, ajustes de áudio) e **por pista**. Desmarcar aqui é escolha sua e não gera aviso.
7. **Banner de fidelidade** (âmbar): o que o motor ainda não reproduz igual, ou o aviso informativo `RENDER_COM_PROXIES`, com a lista de clipes.
8. **Destino:** pasta e nome do arquivo.
9. **Após concluir:** abrir a pasta, copiar o caminho, salvar como ou ingerir na biblioteca.
10. **Exportar Rascunho** ou **Exportar Master**.

### Aceleração por hardware e verificação prévia (preflight)

- **Aceleração:** o render usa o mesmo codificador escolhido na aba **Hardware & GPU** ([seção 13](#13-hardware-aceleração-por-gpu-e-fallback-automático)): NVENC (Nvidia), QuickSync (Intel) ou AMF (AMD), com a CPU como alternativa automática.
- **Preflight:** ao abrir o painel e a cada mudança de preset ou de faixa, o programa confere a timeline antes de gastar tempo de render e mostra **avisos** (o render segue, mas algo pode ficar diferente do monitor; ficam no banner âmbar) e **bloqueios** (o render não pode começar até você resolver; os botões de exportar ficam desabilitados e o motivo aparece no painel).

### Rascunho × Master

| | Rascunho | Master |
|---|---|---|
| Mídia | Proxies locais | **Originais** (HD externo) |
| Altura | 540p | Resolução da sequência |
| Qualidade | Compressão alta, rápido | Compressão baixa |
| Serve para | Conferir montagem e efeitos | Entrega |

**Os dois usam os mesmos efeitos.** O rascunho não é menos fiel, é só mais barato.

Se o HD dos originais estiver desconectado, o master **não cai calado para o proxy**: ou recusa e lista os clipes sem arquivo, ou (com a opção **Usar Proxies Locais** marcada) segue em proxy, exibe o aviso de fidelidade e põe `_proxy` no nome do arquivo.

### Enquanto roda, e depois

A fila é **sequencial**: um render por timeline por vez. O progresso aparece no rodapé do painel e na aba Tarefas, com percentual real e tempo estimado. **Fechar o modal não cancela** o trabalho. Cancelar encerra o processo e apaga o arquivo parcial (um MP4 truncado que parece pronto é pior que nenhum).

Ao terminar, aparecem **Abrir pasta** (com o arquivo já selecionado) e **Copiar caminho**.

### Quando algo dá errado

| Situação | O que aparece |
|---|---|
| Motor de render não instalado | "O motor de render ainda não está instalado nesta versão" |
| Pedido recusado | Qual campo foi recusado e por quê |
| Já existe um render dessa timeline | Explica a fila sequencial e o que fazer |
| Sem resposta do servidor | "Não consegui falar com o servidor" |

---

## 17. Gerador e editor de títulos, legendas e cartelas

O CapIAu-Talho tem um sistema completo de títulos, cartelas, GCs (lower thirds) e legendas na própria timeline.

### Tipos de clipes de texto

1. **Lower thirds (GCs):** nomes, cargos e funções dos entrevistados, com caixas de contraste (fundo translúcido).
2. **Títulos de abertura e capítulos:** grandes títulos estilizados.
3. **Cartelas de contexto e citações:** texto centralizado, com tipografia cinematográfica.
4. **Créditos de encerramento:** duas colunas (função e nome) ou blocos normalizados a partir do banco de dados ou do roteiro.
5. **Legendas:** falas transcritas convertidas em clipes de legenda com tempo quadro a quadro.

### Edição direta no player

- **Arrastar e posicionar.** Com o player pausado sobre um clipe de texto, caixas interativas permitem arrastar o título livremente.
- **Redimensionar.** As alças dos cantos mudam o tamanho da fonte e a largura da caixa.
- **Editar no lugar.** Duplo clique no texto sobre o vídeo permite digitar direto.

### Fontes

O **Catálogo de Fontes** reúne tipografias por categoria (*Serif*, *Sans-Serif*, *Display*, *Handwriting*, *Monospace*), com prévia em tempo real e carregamento sob demanda. As famílias vêm do **Google Fonts** e são baixadas quando usadas, então a prévia e o render de títulos precisam de conexão com a internet na primeira vez que uma fonte aparece.

### Animação

- Animação de posição X/Y, escala, opacidade, fade-in e fade-out, com curvas *Linear*, *Ease-In*, *Ease-Out* e *Ease-In-Out*.
- Presets prontos, como *Typewriter*, *Slide & Fade*, *Minimal Clean* e *Documentary Gold*.

### Normalizador de créditos

Na aba **Títulos & Créditos**, cole o texto bruto da equipe e do elenco, ou use os dados dos personagens do projeto. O normalizador padroniza espaçamentos e hierarquias e calcula a duração correta na timeline.

### Exportação de legendas e títulos

- **SRT e WebVTT:** exporte as faixas de texto como `.srt` e `.vtt`, com tempos em milissegundos.
- **OpenTimelineIO:** os clipes de texto vão como títulos genéricos (`GeneratorReference`), preservando fonte, cor, animação e posição para Kdenlive, Premiere, Resolve e Final Cut. Na prática, a aparência pode variar de acordo com o programa de destino.

---

## 18. Instalação e inicialização (resumo)

O passo a passo completo (Docker, instalação local, chaves de API, modelos de denoise e outros opcionais) está na wiki: **[Instalação e Configuração](https://github.com/fernangcortes/capiau-talho-v03/wiki/02.-Instalacao-e-Configuracao)**.

Em resumo:

- **Docker (caminho mais simples):** copie `.env.example` para `.env`, preencha `OPENROUTER_API_KEY` (e `ASSEMBLYAI_API_KEY` para a transcrição na nuvem) e rode `docker compose up --build`. Abra `http://localhost:8000`.
- **Sem Docker:** use Python 3.12 (recomendado, é o usado na imagem Docker; versões anteriores à 3.14, pois o OpenTimelineIO ainda não suporta a 3.14).
- **Atalho no Windows:** dê duplo clique em `criar-atalho.bat` para criar o ícone **CapIAu** na Área de Trabalho (depois, botão direito › **Fixar na barra de tarefas**). Ao abrir o atalho, ele usa o servidor já ativo, ou sobe o Docker, ou inicia o servidor local, e abre o navegador em `http://localhost:8000`.
- **Servidor que não fecha com o terminal (Windows):** `python scripts/launch_detached.py` inicia o servidor desvinculado do terminal; ele continua rodando mesmo que a janela seja fechada.

> **Atenção:** nesta versão o servidor não exige login e aceita conexões de qualquer origem na porta 8000. Use apenas em uma máquina ou rede de confiança e não exponha a porta à internet. Um plano de autenticação e restrição de rede está previsto, mas ainda não foi implementado.

---

## Problemas comuns por sintoma

| Sintoma | O que verificar |
|---|---|
| Cliquei em **Escanear a pasta watch/** e nada apareceu | Confira se os arquivos estão em `watch/` e se o formato é de vídeo, áudio ou foto comum. Espere o fim da geração de proxies e veja a aba **Tarefas** e a aba **Logs**. |
| A transcrição falha ou não começa | Verifique a chave `ASSEMBLYAI_API_KEY` (no `.env` ou nas Configurações) e a conexão com a internet. A transcrição local é experimental e pode ser muito lenta. |
| Descrições de B-roll e fotos vazias ou com erro | Verifique `OPENROUTER_API_KEY` e o saldo da conta. Se estiver usando um modelo gratuito, troque para o padrão pago; veja a [seção 12](#12-seleção-de-modelos-de-ia-e-gestão-de-tarefas). |
| O vídeo da timeline engasga na reprodução | Gere os proxies, desative as miniaturas das pistas ([5.15](#515-miniaturas-nas-pistas)) e confira a aba **Hardware & GPU** ([seção 13](#13-hardware-aceleração-por-gpu-e-fallback-automático)). |
| Não consigo mover, aparar ou apagar um clipe | A pista pode estar travada pelo cadeado. Clique no cadeado da pista ou use `Shift+L` ([5.11](#511-controles-nativos-de-pistas-mute-solo-sync-lock-e-trava)). |
| A exportação saiu diferente do que vejo na tela | A exportação usa a versão **salva**. Clique em **Salvar e usar esta versão** no painel ([seção 16](#16-exportar-vídeo-render-da-timeline-em-mp4)). |
| Um atalho "não funciona" | Ele pode depender do contexto (painel em foco, ferramenta ativa, hover) ou do perfil escolhido. Veja a [seção 14](#14-atalhos-de-teclado-e-perfis-nle). |
| O tratamento de áudio com IA não aparece ou avisa que falta algo | O modelo de denoise precisa ser baixado uma vez. Veja a [Instalação e Configuração](https://github.com/fernangcortes/capiau-talho-v03/wiki/02.-Instalacao-e-Configuracao). |

Para os demais casos, consulte a [Solução de Problemas e FAQ](https://github.com/fernangcortes/capiau-talho-v03/wiki/16.-Solucao-de-Problemas-e-FAQ) na wiki.
