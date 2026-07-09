# Manual do Usuário — CapIAu-Talho Making Of Editor

Bem-vindo ao **CapIAu-Talho Making Of Editor**! Este guia prático descreve o passo a passo de como importar suas mídias, transcrever depoimentos, mapear imagens semanticamente, interagir com o agente de edição e realizar a pré-edição do seu documentário de forma profissional.

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
4. O diálogo completo aparecerá no painel direito, dividido por falantes (ex: *Speaker A, Speaker B*) com timestamps atômicos.
5. **Dica de ouro:** Clique em qualquer palavra ou frase do texto e o player de vídeo pulará exatamente para aquele segundo da fala!
6. **Assistente de Diarização:** A transcrição agora conta com um assistente robusto para corrigir falantes. Na lateral direita superior da transcrição, você verá a "Gaveta de Pistas" que aponta possíveis erros da inteligência artificial (como falas muito longas com silêncio no meio, ou um rosto diferente falando).
7. **Inspetor de Balão (Waveform):** Clique com o botão direito sobre o nome de qualquer falante em um balão de transcrição. Uma gaveta lateral se abrirá exibindo o **Inspetor de Fala**, com uma *waveform interativa*. Com ela você pode:
   * **Dividir falas:** Dê um clique duplo em qualquer ponto da onda de áudio (waveform) para dividir a fala naquele exato milissegundo. O player navegará direto para o trecho.
   * **Atribuição Rápida de Rosto:** O inspetor detecta quem está aparecendo no vídeo naquele trecho e já sugere o nome da pessoa em um menu suspenso para você corrigir o falante com 1 clique.

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

## 🤖 3. Assistente Conversacional de Edição (Chat-Agente) & Ghost Clips

O painel de Chat agora funciona como um **Agente Editor Ativo** que pode realizar modificações físicas na sua timeline a partir de ordens textuais simples (ex: *"insira o clipe 2 na pista V1"*, *"aplique um fade de 1s no primeiro clipe"*, *"cubra o depoimento do diretor com B-rolls do set"*).

* **Modo Direto vs. Modo Rascunho (Ghost Clips):**
  * Edições pontuais e não-destrutivas (como inserir ou ajustar um único clipe) são aplicadas **diretamente na timeline** (e podem ser desfeitas com `Ctrl+Z`).
  * Edições em massa ou destrutivas (como substituições amplas ou rough cuts automáticos) são exibidas na timeline como **clipes fantasmas (ghost clips)** hachurados em verde (para inserções/substituições) ou vermelho (para remoções).
* **Ações sobre Ghost Clips:**
  * Para **aceitar** uma sugestão e torná-la definitiva: selecione o clipe fantasma na timeline e pressione **`Enter`** (ou a tecla **`Y`**, ou clique no botão `✓` do popup correspondente).
  * Para **rejeitar** e descartar a sugestão: selecione o clipe fantasma e pressione **`Delete`** (ou **`Backspace`**, ou clique no botão `✗` do popup correspondente).

---

## 👥 4. Mapeamento de Rostos, Objetos e Desambiguação Rápida

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

* **Preview de Contexto Instantâneo (Hover):** Algumas miniaturas podem estar desfocadas ou muito aproximadas. Para ver o contexto original completo, basta **deixar o mouse posicionado em cima do card**. O sistema carregará instantaneamente um popover flutuante com a foto original completa ou um trecho de vídeo de 5 segundos rodando em loop ao redor daquele frame.
* **Marcar como Objeto ou Rejeitar (Não Relevante):** 
  * Clique no ícone de banir (vermelho) no canto do card.
  * Um prompt perguntará se o elemento é um objeto relevante do cenário. Se for (ex: `Câmera`), digite o nome do objeto. Se for apenas ruído visual, deixe em branco e confirme. O elemento será rotulado como `Não Relevante` e ignorado pelas descrições do RAG.
* **Seleção em Massa (Bulk Actions):** 
  * Selecione múltiplos cards clicando neles.
  * Na barra de ações inferior, digite um nome e clique em **Aplicar** para nomear todos ao mesmo tempo. Se o nome já pertencer a outro grupo, o sistema mesclará os grupos em background.
  * Clique em **Descartar** para rejeitar todas as marcações selecionadas de uma vez.

---

## 🎛️ 5. Pistas de Áudio Reais e J/L-Cuts Nativos

O CapIAu-Talho suporta trilhas de áudio independentes (`A1`, `A2`...) vinculadas aos clipes de vídeo (`V1`, `V2`...).

* **Vínculo de Clipes (Link A/V):** Por padrão, os clipes de vídeo e seus respectivos áudios são importados de forma acoplada (`link_id`). Ao arrastar o vídeo na timeline, o áudio correspondente o acompanha de forma sincronizada.
* **Edição de J-Cuts e L-Cuts (Trims Independentes):**
  * Para desvincular o par de áudio e vídeo e fazer edições independentes (por exemplo, estender o áudio de uma fala sobre a cena do B-roll seguinte, ou fazer o áudio do B-roll entrar 1s antes do corte do vídeo), selecione o clipe e pressione a tecla **`U`** (Desvincular).
  * Após desvincular, você pode mover ou ajustar as bordas (*trim*) de cada faixa de forma independente na timeline.
  * O player do programa interpretará a sobreposição, reproduzindo o vídeo de uma faixa e o áudio da outra simultaneamente em tempo real.
* **Dividir Clipe (Split - Tecla `Z`):**
  * Selecione qualquer clipe na timeline e pressione a tecla **`Z`** para cortá-lo ao meio exatamente na posição da agulha (playhead).
  * Se o clipe de vídeo possuir um clipe de áudio vinculado (`link_id`), o corte é aplicado a ambos os clipes de forma sincronizada, mantendo as metades resultantes vinculadas individualmente.

---

## 🔄 6. Carrossel de Alternativas da IA (Atalho `A`)

Sempre que a IA propuser e inserir um vídeo na timeline, ela indexará trechos alternativos parecidos do acervo. Isso permite que você substitua clipes de forma extremamente dinâmica:

1. **Selecionar e Abrir:** Clique em qualquer clipe gerado pela IA (identificado com borda diferenciada) na timeline para selecioná-lo e pressione a tecla **`A`** no teclado.
2. **Modal com Vídeo Previews:** Um modal com fundo desfocado surgirá no centro da tela, exibindo um card para cada clipe alternativo. Cada card mostra o vídeo correspondente rodando automaticamente em loop silencioso de 5 segundos daquele trecho exato da recomendação.
3. **Mecanismo de Substituição (Swap):** Abaixo da justificativa de uso do clipe, você encontrará dois ícones de linha para substituição:
   * **`↔` Slot Fixo:** Substitui a mídia atual pelo candidato selecionado, ajustando os pontos de entrada e saída para caber exatamente na mesma duração da timeline.
   * **`↠` Ripple:** Substitui o clipe aplicando a duração ideal recomendada do candidato e empurra (ou puxa) automaticamente todos os clipes subsequentes da mesma trilha.
4. **Desfazer:** Todas as trocas são salvas no histórico local e podem ser revertidas com `Ctrl+Z`.

---

## 🎬 7. Salvando e Exportando sua Timeline

1. À medida que edita, dê um nome para a sua sequência no campo de texto (ex: *Montagem Inicial*).
2. Clique em **`Salvar`** para gravar a timeline no SQLite.
3. Escolha o formato de saída no seletor (XML para Premiere/Resolve/FCP, OpenTimelineIO `.otio` ou EDL).
4. Clique em **`Exportar`**. O download iniciará no seu navegador e o arquivo estará pronto para ser importado no seu editor NLE profissional.

---

## 🎛️ 8. Layout e Organização Avançada

### Workspace "Estúdio" (Layout Flexível de Alta Densidade)
* Para decupagens robustas, ative o botão **Estúdio** no topo da tela.
* Este modo reorganiza completamente a interface. A biblioteca ganha espaço predominante. Os dois monitores (Source e Program) são empilhados na segunda coluna em formato ultralimpo, onde seus controles de player só aparecem no *hover* do mouse (`position:absolute`), e a transcrição fica disponível como uma terceira coluna colapsável. A linha do tempo expande em 100% da largura inferior.
* **Altura das Pistas:** Tanto no layout Padrão quanto no Estúdio, você pode ajustar a altura das trilhas da timeline de duas formas:
  1. Usando o slider vertical global na barra de ferramentas superior.
  2. Clicando e arrastando a borda inferior do cabeçalho de uma trilha individual à esquerda (para redimensionamentos independentes que são salvos na sessão local).

### Reposicionamento dos Controles de Zoom e Modo de Exibição
* Os botões de **Modo de Visualização** (Lista ou Cards) e o controle deslizante de **Zoom** das miniaturas foram movidos para a linha inferior da barra de ferramentas da biblioteca (Linha 3).
* Todos os controles dessa linha (Zoom, Visualização, Expandir Tudo, Recolher Tudo e Abrir Fotos no Player) foram otimizados como ícones simples (*line-icons*) livres de contornos e boxes, minimizando a poluição visual na biblioteca.

### Inserção Rápida e Arrastar-e-Soltar (Drag-and-Drop)
* Você pode adicionar mídias à timeline de duas formas:
  1. **Arrastar-e-Soltar:** Clique e segure qualquer vídeo ou foto na barra lateral e arraste-o diretamente para a trilha desejada na timeline.
  2. **Inserção Rápida:** Passe o mouse sobre qualquer miniatura de foto para revelar um botão flutuante "+". O clique adicionará a imagem como still (duração padrão de 5s) na timeline no ponto da agulha.
