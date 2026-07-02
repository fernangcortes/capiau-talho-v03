# Manual do Usuário — CapIAu-Talho Making Of Editor

Bem-vindo ao **CapIAu-Talho Making Of Editor**! Este guia prático descreve o passo a passo de como importar suas mídias, transcrever depoimentos, mapear imagens semanticamente e realizar a pré-edição do seu documentário de 20 horas de forma profissional.

---

## 📂 1. Estrutura de Pastas e Organização das Mídias

Para processar seu material de forma limpa, o CapIAu-Talho utiliza a seguinte estrutura local criada no seu computador:

* **`watch/`:** A porta de entrada do sistema. Qualquer mídia (vídeo, áudio ou foto) colocada aqui será identificada para processamento.
* **`data/originals/`:** Armazena as mídias originais copiadas de forma segura pelo sistema.
* **`data/proxies/`:** Onde ficam os proxies leves em 720p/360p gerados automaticamente para reprodução suave no player Web.
* **`data/exports/`:** Onde são gravados seus arquivos finais de edição (XML, EDL, OTIO).

### Regra de Ouro para Nomenclatura de Arquivos:
Para ajudar a IA a identificar seus clipes de forma inteligente na ingestão:
* Arquivos que contenham depoimentos falados de equipe/elenco devem ter **`entrevista`** ou **`depoimento`** no nome (ex: `entrevista_diretor_lentes.mp4`). Eles serão categorizados como **Entrevistas (ASR)**.
* Cliques de bastidores ou set devem ter outros nomes (ex: `set_bastidores_vfx_take1.mp4`). Eles serão catalogados como **Bastidores (B-Roll)**.

---

## 🎬 2. Fluxo de Trabalho Passo a Passo

### Passo A: Ingestão de Mídias
1. Copie alguns vídeos de entrevistas, B-rolls ou fotos do set para a pasta `watch/`.
2. No cabeçalho do Dashboard Web, clique no botão **`Escanear watch/`**.
3. O FastAPI lerá a pasta, calculará o hash de segurança (evitando duplicatas), extrairá os metadados via FFprobe e iniciará a compressão do proxy H.264 em background no seu processador i7.
4. As mídias aparecerão na barra lateral esquerda nas abas **Mídias** e **Fotos Set**.

### Passo B: Transcrição (ASR) e Diarização de Entrevistas
1. Na aba **Mídias**, clique em uma entrevista carregada (ela começará a tocar no player).
2. No menu lateral direito, clique no botão **`Transcrever Vídeo Atual`**.
3. A API AssemblyAI fará o processamento na nuvem em segundos (usando seu Free Tier).
4. O diálogo completo aparecerá no painel direito, dividido por falantes (ex: *Falante A, Falante B*) com timestamps atômicos.
5. **Dica de ouro:** Clique em qualquer palavra ou frase do texto e o player de vídeo pulará exatamente para aquele segundo da fala!

### Passo C: Decupagem Visual de B-Rolls e Fotos
1. No backend real, os vídeos de B-roll sofrem decupagem a cada 10s extraindo frames-chave e enviando para o Gemini 2.5 Flash no OpenRouter.
2. A IA gera descrições narrativas de bastidores e cria tags visuais automáticas (ex: `câmera`, `luz`, `dolly`).
3. Para as fotos de set, o mesmo acontece: elas são analisadas visualmente e catalogadas na aba **Fotos Set** com descrições ricas.

### Passo D: Agrupamento em Temas (Clustering)
1. Após transcrever suas entrevistas principais, clique no botão **`Agrupamento Temático`** (ou *Agrupar Temas*) no cabeçalho.
2. O DeepSeek V3 lerá as transcrições das entrevistas e proporá de 5 a 10 temas estruturados sobre o making of (ex: *Lentes Anamórficas, Fotografia, Roteiro*).
3. Esses temas aparecerão na aba **Temas** na barra lateral esquerda, facilitando a navegação temática.

### Passo E: Busca Semântica Híbrida e Controles de Playlist
No campo de busca no topo, pesquise por conceitos (ex: *"diretor falando sobre iluminação"* ou *"câmeras no set"*). 
O Qdrant embutido na sua CPU fará uma busca vetorial instantânea e retornará falas de entrevistas, frames de B-roll ou fotos de set correspondentes no painel direito. Clicar no resultado abre a mídia correspondente.

* **Agrupamento & Ocorrências Secundárias:** Os resultados são desduplicados por arquivo de mídia. Trechos e falas secundárias adicionais do mesmo vídeo são agrupados em uma seção sanfonada abaixo do card principal. Clique em *"Ver mais ocorrências (X)"* para expandir os sub-cards correspondentes.
* **Pre-visualização Rápida (Hover Previews):** Posicione o cursor do mouse sobre qualquer card ou sub-card de resultado da busca. Após 400ms, um popover lateral surgirá mostrando um preview em loop mudo de 5 segundos do trecho exato (para vídeos) ou a imagem da foto.
* **Playlist de Busca e Autoplay Sequencial:** Uma barra de controle de playlist com botões de Retroceder (`⏮`), Autoplay (`Play / Parar`) e Avançar (`⏭`) é injetada no topo do feed de resultados.
  * Ao clicar em um card ou sub-card, ele é selecionado e destacado com uma borda brilhante e a playlist é ativada.
  * Ative o **Autoplay** clicando no botão correspondente. Os vídeos tocarão nos timestamps corretos e pularão automaticamente para o próximo resultado. No modo Autoplay, as fotos são exibidas diretamente dentro da área do player de vídeo por 4 segundos antes de avançar, sem abrir popups ou modais.
  * **Opção de Exibição de Fotos no Player:** Caso queira que o clique manual em fotos abra diretamente no player de vídeo em vez do Lightbox tradicional, marque a opção "Abrir fotos no player de vídeo" (disponível na aba de fotos da biblioteca à esquerda e na barra de opções de busca à direita). Ambas as caixas de seleção permanecem sincronizadas.

---

## ⌨️ 3. Atalhos do Player Profissional (Teclado)

Para editar em velocidade profissional de ilha de corte, use os atalhos de teclado idênticos ao Premiere/Resolve (certifique-se de que a caixa de pesquisa do topo não esteja selecionada):

### Atalhos de Reprodução JKL:
* **Tecla `K` / `Espaço`:** Pausar ou Reproduzir o vídeo.
* **Tecla `L`:** Avança o vídeo. Aperte **L** repetidamente para acelerar a reprodução (**1.5x, 2x, 4x, 8x**).
* **Tecla `J`:** Retrocede o vídeo de forma reversa rápida. Aperte **J** repetidamente para acelerar o retrocesso (**-1x, -2x, -4x, -8x**).

### Atalhos de Corte (In/Out):
* **Tecla `I`:** Marca o ponto de **IN** (tempo inicial do corte). Um marcador azul aparecerá na barra de progresso.
* **Tecla `O`:** Marca o ponto de **OUT** (tempo final do corte). Um marcador vermelho aparecerá na barra de progresso.
* **Tecla `E` (ou botão "Cortar & Inserir"):** Recorta o trecho selecionado (entre os pontos IN e OUT) e o insere de forma automática na trilha correspondente na timeline inferior!

### Controles de Tela e Resolução:
* **Seletor de Resolução:** Altere no player para **360p Proxy** se notar lentidão no carregamento, ou **720p Proxy** para melhor visualização.
* **Menus Retráteis:** Clique nos botões de setas nos cantos de cada painel para fechar as barras laterais esquerda e direita. O player de vídeo central se expandirá de forma responsiva na tela de acordo com o espaço liberado. Para reabrir, clique nos botões circulares flutuantes correspondentes!

---

## 🎬 4. Salvando e Exportando sua Timeline

1. À medida que insere clipes na timeline (Trilha V1 para falas/entrevistas e V2 para B-rolls), eles aparecerão no painel inferior.
2. Dê um nome para a sua sequência no campo de texto (ex: *Rascunho Sequência 1*).
3. Clique em **`Salvar`** para gravar a timeline no SQLite local.
4. Escolha o formato de saída no seletor (ex: **`Premiere / Resolve XML`** para importar direto no Premiere/Resolve/FCP, ou **`OpenTimelineIO (.otio)`**).
5. Clique em **`Exportar`**. O arquivo será gerado instantaneamente no disco e o download iniciará no seu navegador!

---

## 👁️ 5. Mapeamento de Rostos, Objetos e Desambiguação Rápida

O CapIAu-Talho conta com uma interface completa de decupagem visual para gerenciar as marcações de pessoas e elementos do set de filmagem.

### A. Exibição e Desenho Livre (Drag-and-Draw) no Player
* **Visualização Inteligente:** As caixas delimitadoras de rostos e objetos (`face-box`) ficam ocultas por padrão no player para não poluir a visualização. Elas aparecem instantaneamente ao passar o mouse perto do rosto ou objeto quando o player estiver **pausado**.
* **Desenhar novas caixas:** Se quiser cadastrar um objeto do cenário (ex: `Abajur`, `Microfone de Lapela`) ou uma pessoa não detectada automaticamente:
  1. Pause o vídeo no frame desejado.
  2. Clique com o botão esquerdo e arraste o mouse sobre o objeto para desenhar um retângulo pontilhado roxo.
  3. Ao soltar, uma janela de prompt surgirá. Digite o nome do objeto ou pessoa (ou escolha um nome sugerido na lista) e confirme.
  4. O retângulo se fixará na tela e atualizará automaticamente as tags na aba **Visão IA**.

### B. Desambiguação Rápida em Tela Cheia
Na aba **Grupos de Rostos**, clique em **`Desambiguação Rápida`** para abrir o gerenciador em tela cheia. Aqui, você verá todas as detecções ainda sem nome ou não validadas do seu projeto:

* **Preview de Contexto Instantâneo (Hover):** Algumas miniaturas podem estar desfocadas ou muito aproximadas. Para ver o contexto original completo, basta **deixar o mouse posicionado em cima do card**. O sistema carregará instantaneamente um popover flutuante com a foto original completa ou um trecho de vídeo de 5 segundos rodando em loop ao redor daquele frame. Os previews utilizam arquivos proxies locais otimizados para garantir rapidez.
* **Marcar como Objeto ou Rejeitar (Não Relevante):** 
  * Clique no ícone de banir (vermelho) no canto do card.
  * Um prompt perguntará se o elemento é um objeto relevante do cenário. 
  * Se for (ex: `Câmera`), digite o nome do objeto. Ele será catalogado e integrado nas buscas semânticas da biblioteca, sem poluir o agrupamento de rostos de pessoas.
  * Se for apenas ruído visual, deixe em branco e confirme. O elemento será rotulado como `Não Relevante` e ignorado pelas descrições do RAG.
* **Seleção em Massa (Bulk Actions):** 
  * Você pode clicar em múltiplos cards para selecioná-los.
  * Uma barra inferior de ações surgirá. 
  * Digite um nome e clique em **Aplicar** para nomear todos ao mesmo tempo. Caso haja um conflito de grupos (se o nome já pertencer a outro grupo), o sistema mesclará automaticamente os grupos em background.
  * Clique em **Descartar** para rejeitar todas as marcações selecionadas de uma vez, com a opção de catalogá-las conjuntamente como um mesmo objeto (ex: `Cadeira`).
