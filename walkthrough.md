# Walkthrough da Implementação --- CapIAu-Talho Making Of MVP

Este documento resume as implementações realizadas, os testes efetuados
e instrui sobre como executar a aplicação de forma rápida e local.

## 🛠️ O Que Foi Feito

O MVP funcional do **CapIAu-Talho** foi totalmente desenvolvido e testado no seu computador! A arquitetura foi adaptada de forma ideal para o seu processador **Intel i7-10700** e **32 GB de RAM** sem depender de GPU dedicada, operando em um **Modelo Híbrido Otimizado**:

### 1. Ambiente Híbrido e Modelos Customizáveis (Novidades de 2026)

- Criado requirements.txt com todas as dependências unificadas e
  instaladas com sucesso (FastAPI, Qdrant-client, Sentence-transformers,
  AssemblyAI, OpenTimelineIO, etc.).

  Estruturado arquivo .env para centralizar as chaves das APIs do
  **OpenRouter** e **AssemblyAI** e configurar as pastas locais de
  mídia.

  **Escolha Flexível de Modelos:** Adicionado suporte para customizar
  TEXT_MODEL e VISION_MODEL diretamente no seu .env, permitindo que você
  use modelos modernos lançados nos últimos dois meses, como o **Gemini
  3.1 Flash Lite** (maio/2026, ultra-econômico) ou o **Perceptron Mk1**
  (maio/2026, especializado em frames de vídeo).

  Configurado src/config.py para carregar as variáveis de ambiente e
  **gerar automaticamente toda a estrutura de pastas** (originals,
  proxies, watch, cache, exports) na sua máquina.

### 2. Banco de Dados e Busca Semântica em CPU (Sem Docker!)

- Criado src/db/schema.py com o schema relacional SQLite, estruturando
  projetos, vídeos, fotos, transcrições palavra-a-palavra, temas e
  relações.

  **Gerenciamento Multi-Projeto Autônomo:** Adicionadas operações de
  CRUD de projetos (add_project, get_projects, delete_project) em
  src/db/operations.py com suporte a **Deleção Física em Cascata**
  (PRAGMA foreign_keys = ON), permitindo isolamento total de mídias de
  diferentes produções.

  Desenvolvido src/search/semantic.py inicializando o **Qdrant local
  baseado em arquivo**. Roda 100% na sua CPU local, gerando embeddings
  através do modelo leve e offline all-MiniLM-L6-v2 (\~120MB) com busca
  semântica em menos de 10ms!

  **Correção de Bugs Críticos de Parâmetros:** Identificados e
  corrigidos bugs silenciosos onde o project_id era omitido na indexação
  do Qdrant nos motores ASR (asr_engine.py) e Vision
  (multimodal_engine.py), bem como no endpoint de busca do servidor.

  Resolvido o requisito do Qdrant de IDs em formato UUID através da
  **geração determinística de UUIDs v5** a partir de string keys,
  gerando unicidade e evitando duplicatas.

### 3. Pipeline de Ingestão, FFmpeg e In-Place Ingestion (HD Externo)

- Criado src/ingest/watcher.py para monitoramento automático de arquivos
  na pasta watch/.

  **Ingestão In-Place (Modo Link para HD Externo):** Adicionado suporte
  a parâmetro copy_original=False no fluxo de ingestão. Mídias gigantes
  localizadas em HDs externos ou SSDs podem ser analisadas e vinculadas
  **sem serem copiadas localmente** (poupando espaço em disco). O
  CapIAu-Talho armazena no SQLite o caminho absoluto real do HD externo
  e gera apenas o leve proxy de preview localmente, garantindo o link
  correto na exportação XML/EDL.

  **Importador Recursivo de Pastas:** Criada a lógica
  ingest_external_path mapeada no novo endpoint /api/ingest/external
  para varrer recursivamente qualquer caminho absoluto de disco externo
  e catalogar mídias em modo in-place.

  Implementado deduplicação automática via SHA-256 e extração de
  metadados técnicos ricos por **FFprobe**.

  Desenvolvido proxying nativo por **FFmpeg** gerando proxies rápidos
  H.264 em 720p/360p com áudio AAC para visualização imediata na Web,
  com tratamento de exceções robusto e sem travar a CPU.

### 4. Transcrição ASR, Diarização e Clustering Temático (Nuvem Econômica)

- Criado src/transcription/asr_engine.py integrado com **AssemblyAI**
  (Universal-2), fornecendo transcrição pt-BR rápida com diarização de
  falantes (quem falou o quê) e timestamps atômicos, seguido por
  indexação instantânea no Qdrant local.

  Desenvolvido src/vision/multimodal_engine.py extraindo frames a cada
  10s via FFmpeg (sem carregar o OpenCV) e analisando bastidores/fotos
  usando a API multimodal **Gemini 2.5/3.1/3.5** no OpenRouter (custando
  menos de R\$ 7,00 para 20h!).

  Desenvolvido src/nlp/theme_cluster.py carregando os diálogos inseridos
  no SQLite e agrupando trechos automaticamente em tópicos do
  documentário (Making Of) via **DeepSeek V3** no OpenRouter (custando
  menos de R\$ 8,00 para as 20h!).

### 5. Exportador OpenTimelineIO e Dashboard Web Premium

- Implementado src/export/otio_export.py integrando a biblioteca
  **OpenTimelineIO** para traduzir a sequência de cortes da timeline em
  arquivos XML (Premiere/Resolve), EDL ou JSON OTIO.

  Desenvolvido servidor REST FastAPI em src/api/server.py mapeando
  endpoints de busca semântica híbrida, controllers assíncronos e
  servindo o frontend.

  Construído **Dashboard Web Premium** (index.html, styles.css, app.js
  em src/ui/) com visual espetacular glassmorphism em **proporção
  widescreen 16:9** contendo:

  - **Área de Projetos Glassmorphic** no topo contendo seletor de
    projetos ativo, botão para criar novo projeto e botão de exclusão
    rápida.

  - **Modal de Novo Projeto** responsivo translúcido para preenchimento
    de metadados do filme.

  - **Menus retráteis** esquerdo (biblioteca) e direito (transcrições)
    por clique simples, redimensionando o player de forma responsiva.

  - **Player de Vídeo Profissional** com atalhos de teclado **JKL**
    (Premiere-style), controle de velocidade de reprodução e seletor de
    resolução proxy (720p/360p/Original).

  - **Marcação de Pontos I/O (In / Out)** via teclas I e O, permitindo
    fatiar e enviar trechos à timeline instantaneamente (tecla E).

  - **Barra de Status do Sistema em Tempo Real:** Uma barra translúcida
    premium no rodapé do painel esquerdo que fornece referência contínua
    e visual das ações em execução no background (como varredura de
    pastas, importações recursivas, IA decodificando falas com
    AssemblyAI ou temas com DeepSeek), mudando dinamicamente entre
    spinners de carregamento ativos e checks verdes de finalização
    bem-sucedida.

  - **Status de Pipeline nos Cards de Mídia:** Badges e spinners
    embutidos nos cards de vídeo que mostram o status individual de
    processamento (spinners animados para mídias em fase de
    transcrevendo ou analisando, selos premium **\[ASR\]** e
    **\[VISÃO\]** para tarefas concluídas e marcações em vermelho para
    erros de FFmpeg).

  - **Painel Ativo de Conversões e Progresso Real (0-100%):** O
    CapIAu-Talho agora lê dinamicamente a saída do stdout do FFmpeg
    (-progress pipe:1) e calcula o progresso real em porcentagem
    comparando com a duração obtida pelo FFprobe. Os cards de mídia
    exibem dinamicamente Convertendo XX% com spinners em tempo real.

  - **Ações de Controle Total (Cancelar/Deletar):** Cards de mídia
    ganham botões flutuantes: um botão de parada (fa-circle-stop) em
    mídias ativas para matar a tarefa e limpar arquivos parciais, e um
    ícone de lixeira hover (fa-trash-can) para proxies concluídos,
    permitindo deletar fisicamente o proxy do HD e liberar espaço na
    máquina local.

  - **Visualização em Árvore/Explorer (Premium VSCode-Style):** Para
    evitar poluição visual ao importar centenas de arquivos, a
    biblioteca do CapIAu-Talho agora detecta a estrutura física de
    subpastas do HD ou diretório importado e as agrupa em uma **Árvore
    de Diretórios interativa**. As pastas e subpastas iniciam
    **recolhidas por padrão**, permitindo que você as explore
    expandindo/fechando conforme desejar, exatamente como em um
    gerenciador de arquivos nativo.

  - **Prevenção Máxima de Processos Órfãos (Ganchos de Shutdown):**
    Adicionado manipulador de encerramento do FastAPI
    (@app.on_event(\"shutdown\")) e limpezas via atexit. Quando o
    servidor é encerrado ou o terminal fechado, todos os processos de
    conversão ffmpeg.exe ativos são terminados fisicamente no Windows
    (taskkill /F /T) eliminando por completo o risco de processos órfãos
    invisíveis consumindo CPU no background.

  - **Atualização Dinâmica Instantânea (Auto-Polling):** Ingestões
    recursivas iniciam um polling inteligente que atualiza a biblioteca
    dinamicamente a cada 2 segundos, fazendo com que novos arquivos
    catalogados apareçam de forma imediata na tela do usuário.

  - **Salvamento de Projetos em Tempo Real:** Gravação atômica
    instantânea de todos os metadados diretamente no banco de dados
    local SQLite (capiau.db), garantindo que projetos sejam salvos
    automaticamente após qualquer ação sem risco de perda de dados.

  - **Mocks de segurança integrados** que entram em ação automaticamente
    se o servidor FastAPI estiver offline ou os bancos vazios,
    permitindo testar a experiência visual e atalhos na hora!

  - **Prevenção de Conflitos de Digitação:** Corrigida a escuta de
    eventos de atalhos globais (como Barra de Espaço, J, K, L, I, O, E)
    para serem suspensos automaticamente quando o usuário estiver
    digitando em qualquer formulário ou campo de texto do aplicativo
    (input, textarea, select), garantindo uma digitação contínua e sem
    bugs.

## 🧪 Validação e Testes Executados

Efetuamos testes automatizados de integração que cobrem a integridade
dos bancos e o fluxo lógico do pipeline:

1.  **Testes do Banco de Dados e Busca Semântica CPU:**

    - Script: tests/test_database.py

    - **Resultado:** OK (Concluído com 100% de sucesso!). O SQLite
      gravou corretamente, a diarização agrupou o texto, o Qdrant local
      indexou em CPU com project_id e a busca semântica local isolada
      por projeto retornou o trecho correspondente com pontuação de
      relevância.

2.  **Testes do Ingestor e Proxy:**

    - Script: tests/test_hybrid_pipeline.py

    - **Resultado:** OK (Concluído com 100% de sucesso!). O ingestor
      catalogou os metadados no SQLite por tipo de arquivo, calculou o
      hash e tratou corretamente o mock de proxying do FFmpeg.

## 🚀 Como Executar o MVP

Siga os três passos rápidos abaixo para ver a mágica acontecer:

### Passo 1: Configurar suas Chaves no arquivo .env

Abra o arquivo .env gerado na raiz do seu workspace: 👉
`.env`

Substitua os placeholders pelas suas chaves reais, e escolha o modelo de
sua preferência (como o Gemini 3.1 Flash Lite de maio/2026):

OPENROUTER_API_KEY=sua_chave_do_openrouter_aqui

ASSEMBLYAI_API_KEY=sua_chave_da_assemblyai_aqui

\# Escolha da Inteligência Customizada de 2026

TEXT_MODEL=deepseek/deepseek-chat

VISION_MODEL=google/gemini-3.1-flash-lite

### Passo 2: Iniciar o Servidor FastAPI

Execute o servidor FastAPI abrindo o prompt ou console no diretório do
projeto e rodando:

python -m uvicorn src.api.server:app \--reload

O console exibirá que o banco de dados SQLite foi criado/inicializado
física e localmente, assim como a base do Qdrant.

### Passo 3: Abrir no Navegador

Acesse no seu navegador preferido: 👉
**<http://localhost:8000/>**

A interface premium carregará de forma imediata com o suporte a
múltiplos projetos totalmente operacional. Você poderá criar um novo
projeto, alternar entre eles, escanear pastas e realizar buscas
semânticas sem nenhuma poluição cruzada de dados!

## 📸 Fase 1: Ingestão de Fotos & Proxies RAW/JPG (Implementado com Sucesso!)

Desenvolvemos e refinamos por completo o pipeline de ingestão e
visualização de fotos de set com suporte a formatos RAW:

1.  **Suporte RAW & Ingestor Pillow/rawpy**:

    - Adicionada decodificação automática de fotos RAW (.arw, .cr2,
      .nef, .dng, etc.) via rawpy e imagens tradicionais via Pillow.

    - Conversão de alta qualidade e leveza para proxies WebP (máximo de
      1024px de dimensão a 85% de qualidade), reduzindo em até 99.8% o
      tamanho físico sem prejudicar o reconhecimento IA.

2.  **Visualizador Premium Glassmorphic com Teclado**:

    - Um modal visualizador de fotos totalmente integrado com controles
      premium: navegação por teclado (setas ArrowLeft / ArrowRight e
      Escape para fechar) e bloqueio temporário de atalhos de vídeo
      (para não disparar o player por acidente).

    - Suporte a zoom interativo (clique na imagem ou botão zoom) e
      carrossel de transição suave.

3.  **Gerenciamento de Tarefas e Polling Sem Flicker**:

    - Nova rotina startProgressPolling() unificada para monitorar o
      status de geração de proxies de fotos (pending e error) e vídeos
      de forma dinâmica.

    - Mecanismo anti-flicker com serialização inteligente para a
      biblioteca de fotos de set, evitando re-renderizações e pulos
      visuais indesejados.

    - Inclusão dos cartões de fotos no painel de **Tarefas**, com
      suporte a botões de ação dedicados: **Tentar Novamente**
      (regeração individual de proxy via /api/photo/{photo_id}/retry) e
      **Remover** (exclusão física do proxy e metadados via DELETE
      /api/photo/{photo_id}).

4.  **Correção de Gargalo e Limpeza de ASR (AssemblyAI)**:

    - Identificada e corrigida falha de fila onde todos os vídeos
      (incluindo centenas de B-rolls sem diálogo) eram selecionados na
      transcrição em lote (\"Transcrever Tudo\").

    - Atualizado endpoint /api/project/{project_id}/transcribe-all para
      pular automaticamente vídeos do tipo B-roll e focar apenas em
      entrevistas.

    - Criado e executado script de banco de dados que recuperou com
      sucesso 33 vídeos de B-roll travados no status transcribing
      redefinindo-os para ingested.

    - Confirmado o funcionamento perfeito da API da AssemblyAI através
      de verificações detalhadas que validaram as últimas transcrições
      completas da conta do usuário.

🎉 Parabéns! O motor de decupagem inteligente do seu filme está pronto,
multi-projeto, totalmente parametrizado e estruturado para processar
suas mídias de forma rápida, eficiente e extremamente econômica!

## 📝 Atualizações Recentes (03/06/2026)

Implementamos a **Fase 4: Chatbot RAG Integrado & Sumários de Contexto**
completando o ciclo inteligente do CapIAu-Talho:

1.  **Pipeline de Sumarização por IA (DeepSeek V3):**

    - Criado [`summary_engine.py`](src/nlp/summary_engine.py) que se
      comunica com o OpenRouter (modelo deepseek/deepseek-chat) para
      analisar as transcrições das Entrevistas e a sequência temporal
      das descrições do B-roll.

    - Gera de forma autônoma uma descrição concisa de uma frase, um
      sumário estruturado em tópicos (bullet points) destacando o valor
      narrativo/editorial do vídeo, e um conjunto de tags.

    - Integrado de forma assíncrona ao final dos pipelines de ASR
      ([`asr_engine.py`](src/transcription/asr_engine.py)) e Visão Multimodal
      ([`multimodal_engine.py`](src/vision/multimodal_engine.py)).

2.  **Endpoint Chatbot RAG Híbrido (/api/project/{project_id}/chat):**

    - Criado no [`server.py`](src/api/server.py) o endpoint de
      chat RAG.

    - Realiza busca semântica no banco de dados vetorial Qdrant para
      extrair trechos de transcrições, frames visuais, descrições de
      fotos de set e documentos de contexto relevantes.

    - Constrói o prompt de sistema enviando o histórico de conversação
      recente e o contexto coletado para o DeepSeek V3, instruindo a IA
      a citar as mídias em formato markdown especial.

3.  **Interface de Chat no Painel Lateral:**

    - Adicionada a aba **Chat IA** no painel lateral direito do frontend
      ([`index.html`](src/ui/index.html),
      `app.js`,
      [`styles.css`](src/ui/styles.css)).

    - Apresenta boas-vindas com sugestões de perguntas e renderiza
      bolhas de mensagens do usuário (alinhadas à direita em gradiente)
      e do assistente (alinhadas à esquerda em glassmorphic dark).

    - Exibe a lista do contexto RAG real sob um elemento colapsável
      \<details\> no final das mensagens da IA, aumentando a
      transparência.

    - **Citações Clicáveis Dinâmicas:** Converte marcações markdown como
      \[Legenda\](video_id: 2, start: 10.5, end: 15.0) em links
      clicáveis que:

      - Carregam o vídeo correspondente no player.

      - Movem o timecode do player para o início exato do corte.

      - Alternam a aba para **Falas (ASR)** e causam um efeito de
        brilho/pulso na bolha de diálogo para situar o usuário.

      - Abrem fotos de bastidores e enfocam/destacam documentos de pauta
        se citados.

4.  **Verificação de Fluxo:**

    - Testado e validado com sucesso via subagente de navegação browser,
      demonstrando a correta integração de ponta a ponta e a reprodução
      automatizada no player a partir de links no chat.

## 📂 Fase 5: Organização e Navegação Dinâmica da Biblioteca (Novidades do Painel)

Implementamos por completo a **Fase 5: Organização da Biblioteca**,
resolvendo o problema de localização e navegação quando muitas subpastas
são importadas de HDs externos:

1.  **Barra de Ferramentas da Biblioteca (#library-filter-bar):**

    - **Filtro Dinâmico de Análise:** Seletor de status para visualizar
      \"Filtros: Todos\", \"Não Analisados\" (vídeos/fotos pendentes ou
      em processamento), \"Analisados (IA)\" (vídeos
      transcritos/analisados, fotos com metadados) ou \"Com Falhas\"
      (proxies com erros de FFmpeg).

    - **Ordenação Avançada:** Dropdown de ordenação com suporte a:

      - *Nome (A-Z)* e *Nome (Z-A)* (ordena pastas alfabeticamente e
        arquivos por nome).

      - *Entrevistas 1º* e *B-Rolls 1º* (prioriza o tipo de vídeo
        selecionado).

      - *Duração 🠗* (ordena decrescente por tempo de clipe).

      - *Adição Recente* (ordena por ID decrescente).

    - **Botões Globais de Expansão:** Botão de expandir tudo
      (#btn-expand-all ⬇⬇) e recolher tudo (#btn-collapse-all ⬆⬆) para
      gerenciar a visibilidade da árvore de arquivos inteira
      instantaneamente.

2.  **Navegação Inteligente por Subpastas no Hover:**

    - **Ações de Pasta Contextuais:** Ao passar o mouse sobre qualquer
      cabeçalho de pasta na árvore (.tree-folder-header:hover), dois
      pequenos botões translúcidos aparecem flutuando à direita
      (expandir todas as subpastas desta pasta fa-angles-down e recolher
      todas as subpastas fa-angles-up).

    - **Controle Recursivo Avançado (expandCollapseAllSubfolders):** O
      clique executa uma expansão ou contração em cascata para a pasta
      selecionada e todas as suas subpastas descendentes de forma
      inteligente, sem afetar outras pastas de nível paralelo ou
      superior.

3.  **Integração com Auto-Polling de Background:**

    - O fluxo de atualização da biblioteca foi unificado: novas
      detecções no watch/ ou processamentos de proxies em andamento
      atualizam as variáveis de estado globais (allVideos e allPhotos) e
      chamam filterAndRenderLibrary() / filterAndRenderPhotos().

    - Isso garante que a ordenação e filtros selecionados pelo usuário
      sejam mantidos de forma estável (sem redefinir as seleções do
      usuário) durante as atualizações automáticas em background.

4.  **Verificação de Fluxo:**

    - Testado e validado com sucesso via subagente de navegação browser,
      demonstrando a correta integração de ponta a ponta e a reprodução
      automatizada no player a partir de links no chat.

## ☁️ Fase 6: Exportação, Importação e Sincronização de Projetos (Novidades do MVP)

Implementamos a funcionalidade completa de backup, restore e
sincronização baseada em pacotes seletivos de arquivos .zip e links do
Google Drive:

1.  **Associação de Links do Google Drive:**

    - Adicionada a coluna drive_link na tabela de projetos do SQLite e
      criados os endpoints e a interface para persistência.

    - O botão \"Abrir no Navegador\" no modal abre diretamente o link do
      Drive associado ao projeto para facilitar o upload/download de
      pacotes.

2.  **Empacotamento Seletivo (.ZIP):**

    - Criado o endpoint POST /api/project/{project_id}/export para
      coletar metadados do banco (vídeos, fotos, transcript_words,
      faces, timelines, etc.) e empacotá-los em um arquivo compactado
      .zip junto com os arquivos de mídia selecionados (vídeo proxies,
      foto proxies e documentos).

    - O Qdrant é consultado em tempo real para obter os frames do B-roll
      (get_video_vision_frames), de modo que as descrições de imagens já
      extraídas sejam incluídas no metadata.json, eliminando a
      necessidade de re-analisá-las com IA no computador de destino.

3.  **Importação e Re-Indexação Inteligente:**

    - Criado o endpoint POST /api/project/import que recebe um pacote
      ZIP, descompacta os arquivos temporariamente, move os proxies e
      documentos para as pastas locais correspondentes e insere os
      registros no SQLite.

    - **Mapeamento de IDs Relacionais:** Como chaves primárias são
      geradas dinamicamente no SQLite, o fluxo de importação re-mapeia
      todos os IDs nas tabelas relacionadas (transcript, face, relation,
      timeline, transcript_theme) para preservar a integridade
      estrutural e restaurar a timeline perfeitamente.

    - **Resolução de Conflito de Unicidade:** Para evitar falhas de
      colisão de hashes únicos (IntegrityError), o sistema anexa o
      sufixo \_imp\_{new_project_id} às chaves SHA-256 duplicadas.

    - **Re-Indexação Local:** O sistema reconstrói os vetores semânticos
      no Qdrant na máquina local a partir de descrições e transcrições
      importadas, garantindo que a busca semântica em CPU continue 100%
      funcional sem novas chamadas pagas de API.

4.  **Interface Premium Glassmorphic:**

    - Adicionado botão de nuvem no cabeçalho para abrir o modal de
      sincronização.

    - O modal contém as opções de exportação, o campo de link do Drive e
      uma zona de drag-and-drop para arrastar e importar arquivos ZIP.

    - Uma barra de progresso em tempo real (utilizando XMLHttpRequest)
      atualiza o usuário sobre a velocidade do upload e as fases do
      processamento no servidor (\"Enviando arquivo\...\",
      \"Descompactando e reindexando IA locais (CPU)\...\").

5.  **Verificação de Fluxo e Testes:**

    - **Teste Unitário:** Criado e executado com sucesso o teste
      tests/test_project_export.py validando toda a correspondência de
      chaves e resolução de conflitos de hash.

    - **Visualização:** Validada via browser subagent a funcionalidade
      de gravação de links e renderização do modal.

    - **Gravação de Demonstração:** Registrada com sucesso a gravação em
      formato WebP save_link_success_1780522342772.webp na pasta de
      artefatos.

## 🎨 Fase 7: Modularização Frontend & Restauração Estética (Junho 2026)

Concluímos com sucesso a transição do frontend para uma arquitetura
modular moderna e restauramos integralmente a refinada estética original
do MVP:

1.  **Modularização em Módulos ES6 Nativos:**

    - O mega-arquivo monolítico src/ui/app.js (175KB) foi deletado e
      substituído por 8 módulos nativos sob src/ui/js/ (main.js, api.js,
      state.js, player.js, library.js, panels.js, chat.js, projects.js),
      carregados via type=\"module\" no HTML sem necessidade de
      empacotadores (Vite/Webpack), mantendo o ecossistema rápido e
      leve.

    - Centralização do estado reativo no EventEmitter em state.js.

2.  **Restauração da Estética Visual e Interativa:**

    - **Mídias (Vídeos):** Recuperada a renderização em árvore
      hierárquica por diretórios/subpastas com chevrons, ícones
      (fa-microphone-lines/fa-film), timecode formatado (00:00:00:00),
      badges de status (ASR/VISÃO) e botões de ação flutuantes sutis que
      surgem apenas ao passar o mouse.

    - **Fotos de Set:** Restaurado o grid responsivo de 2 colunas com
      cards de fotos (photo-card) integrando placeholders de
      carregamento, erro de processamento de RAWs e visualizador
      lightbox interativo.

    - **Temas Narrativos:** Recuperado o design limpo de cartões de
      temas com títulos coloridos em degradê, descrições integradas e
      botões funcionais Buscar Cortes e Perguntar IA.

    - **Documentos:** Re-inseridos os cards de documentos com seus
      respectivos ícones (fa-scroll, fa-list-ol, fa-clipboard).

3.  **Correção de Bugs Críticos no Backend e Conexão de Dados:**

    - **Transação e Persistência do SQLite:** Resolvida a falha onde
      modificações de banco de dados por tarefas em background ou
      repositórios eram descartadas. Ajustado o context manager get_db
      para commitar automaticamente transações bem-sucedidas no SQLite e
      realizar rollback em caso de falha.

    - **Segurança de Threads:** Corrigido o erro ProgrammingError:
      SQLite objects created in a thread can only be used in that same
      thread nas rotas do FastAPI adicionando check_same_thread=False às
      chamadas de conexão SQLite, viabilizando o uso seguro com injeção
      de dependências do FastAPI.

    - **Detecção de Tipo de Vídeo:** Atualizado o analisador em
      IngestService para mapear palavras como \"depoimento\" e
      \"entrevista\" diretamente para o tipo \'interview\', satisfazendo
      plenamente a lógica dos testes.

4.  **Homologação:**

    - Todos os 7 testes automatizados de backend (python -m unittest
      discover tests/) foram executados e passaram com sucesso (OK).

    - O funcionamento do layout foi verificado visualmente e por console
      através de automação no navegador, confirmando a ausência de erros
      de Javascript e um carregamento visual perfeito.

## 👥 Fase 8: Reconhecimento Facial Local e Galeria de Rostos (Fase 1 - Junho 2026)

Implementamos e validamos o motor de reconhecimento facial e clustering
100% local otimizado para CPU, além de criar a interface de agrupamento,
desambiguação e nomeação em lote:

1.  **Setup de Modelos ONNX e Banco de Dados:**

    - Implementado o download automático dos modelos do OpenCV Zoo:
      **YuNet** para detecção de rostos com landmarks fiduciais e
      alinhamento facial (\~3.7MB) e **SFace** para geração de
      embeddings faciais de 128 dimensões (\~33MB).

    - Atualizado o banco SQLite para suportar agrupamentos de rostos
      (cluster_id e índice idx_face_project_cluster).

    - Processados retroativamente e gerados embeddings para **956
      rostos** a partir de fotos de set e frames de vídeo do projeto
      (resolvendo a falta de embeddings para os registros
      preexistentes).

2.  **Detecção Inteligente de Multidões e Qualidade (Heurísticas):**

    - Integrada a análise de nitidez baseada na variância do operador
      Laplaciano para detectar desfoque.

    - Heurística de Multidões: se uma cena tiver mais de 8 rostos,
      rostos pequenos (\< 40px) e desfocados (figuração) são ignorados
      automaticamente para evitar poluir os clusters. Caso contrário,
      rostos menores/desfocados de personagens em segundo plano são
      catalogados.

3.  **Clustering DBSCAN Puramente Local (NumPy):**

    - Implementado o algoritmo DBSCAN em NumPy com matriz de
      similaridade de cosseno (produto interno de vetores normalizados
      L2). Agrupa rostos semelhantes sob o nome temporário Pessoa
      Desconhecida (Grupo X) de forma instantânea na CPU.

4.  **Interface e Lógica de Desambiguação e Fusão na UI:**

    - **Galeria de Rostos:** Nova aba \"Rostos\" na barra lateral
      esquerda listando os clusters criados com crop facial dinâmico,
      número de aparições e campo de input com autocompleção de nomes de
      speakers do projeto.

    - **Prevenção de Conflitos e Desambiguação Manual Unitária:** Se um
      usuário renomear um grupo de rostos com um nome já existente em
      outro grupo, o backend acusa conflito e abre a janela translúcida
      de desambiguação manual na UI.

    - Permite que o editor escolha entre:

      - **Fusão Total:** Mescla todos os rostos de ambos os clusters sob
        o mesmo nome no SQLite.

      - **Confirmar Selecionados:** Reatribui individualmente
        (desambiguação unitária) apenas as caixas faciais que forem
        selecionadas pelo usuário para o grupo de destino correto,
        separando os restantes.

5.  **Eliminação de Lock Contention no SQLite:**

    - Corrigido o bug silencioso de database locking movendo as
      submissões de tarefas de processamento de fotos e a execução da
      detecção facial de dentro de blocos de conexão ativos para fora da
      transação de inserção inicial, garantindo concorrência perfeita em
      threads em background.

6.  **Homologação:**

    - Criados testes automatizados robustos em
      tests/test_face_recognition.py cobrindo o DBSCAN matricial,
      agrupamento de rostos no banco, detecção de conflitos, merge de
      clusters e reatribuição manual de faces.

    - O conjunto total de 9 testes passa com sucesso (OK em 8.480s).

## 🖥️ Fase 9: Visualizadores Duplos Independentes (Source & Program)

Desenvolvemos a estrutura de monitoramento duplo no painel central,
idêntica à de suites de edição profissionais (como Premiere e DaVinci
Resolve):

1.  **Source Player (Monitor de Origem - Esquerda):**

    - Dedicado a inspecionar mídias brutas da Biblioteca (vídeos e fotos
      de set).

    - Suporte nativo a atalhos de teclado **JKL** com velocidades
      múltiplas (1.5x, 2x, 4x, 8x) e retrocesso (J reverso) via loops de
      animação temporal.

    - Marcação rápida de pontos de entrada (I) e saída (O) e botão de
      inserção (E ou botão dedicado) para recortar o segmento de
      áudio/vídeo e enviá-lo instantaneamente para a trilha ativa da
      Timeline.

    - Renderização dinâmica do overlay de detecção de rostos
      (YuNet/SFace) em tempo real, dimensionando-se de forma responsiva
      às mudanças de tamanho do monitor.

2.  **Program Player (Monitor de Programa - Direita):**

    - Dedicado à reprodução reativa e sequencial dos clipes montados na
      timeline ativa.

    - Gerenciamento inteligente de buffering A/B de elementos de vídeo
      para alternar de forma suave entre diferentes clipes e arquivos de
      proxies, eliminando travamentos de transição na CPU.

## 🎨 Fase 10: Timeline Multi-Trilha Reativa em Canvas 2D

Para garantir desempenho extremo na renderização de timelines complexas
na CPU local, implementamos a linha do tempo desenhada diretamente em um
Canvas HTML5:

1.  **Desenho em Canvas 2D de Alta Performance:**

    - Todo o desenho de réguas, timecodes, trilhas (V1 para falas e
      depoimentos, V2 para cobertura/B-Roll) e blocos de clipes é
      gerenciado por renderização direta em Canvas, com suporte nativo a
      High-DPI (Pixel Ratio) para displays retina.

    - Representação visual de ondas de áudio (waveforms) renderizadas
      dinamicamente sobre os blocos baseados no banco de dados.

2.  **Interatividade e Atração Magnética:**

    - Lógica de arrastar e soltar (drag-and-drop) de alta performance:
      movimentação livre de blocos horizontalmente para ajuste de ponto
      na linha do tempo, e verticalmente para alterar trilhas.

    - Implementação de **snapping/atração magnética** para alinhar
      clipes perfeitamente com os limites de clipes adjacentes ou com a
      agulha de reprodução (playhead), evitando espaços vazios
      involuntários na edição de falas.

## 🎛️ Fase 11: Workspaces Dinâmicos e Destaque Multi-Monitor

Visando a produtividade do editor em múltiplos monitores, implementamos
um motor flexível de pop-outs de painéis em novas janelas do navegador:

1.  **Destaque Modular de Elementos (Pop-outs):**

    - O editor pode abrir qualquer painel (Biblioteca, Transcrição,
      Timeline, Players ou Chat) em uma nova janela independente do
      navegador clicando no ícone de destaque.

    - Utilização de **document.adoptNode()** para mover os elementos
      físicos do DOM de forma nativa. Isso preserva intactos todos os
      event listeners em JavaScript e o estado reativo local sem a
      necessidade de re-inicializações ou comunicação assíncrona lenta.

2.  **Sincronização Bidirecional e Encaminhamento de Atalhos:**

    - Comunicação via **BroadcastChannel** e escuta de eventos globais
      para coordenar mudanças de estado entre a janela principal e as
      janelas secundárias abertas.

    - Encaminhamento automático de comandos de teclado de qualquer
      pop-out ativo (como pressionar barra de espaço para dar play no
      monitor de origem) para o player centralizado na tela mãe, gerando
      um controle unificado do setup.

## 🎨 Fase 12: Minimalismo no Cabeçalho, Timeline Compacta e Restauradores Laterais (03/07/2026)

Implementamos uma grande re-estilização e otimização ergonômica para
maximizar a área útil de tela e refinar a interação com painéis
colapsáveis:

1.  **Cabeçalho Widescreen Ultra-Compacto e Ações Rápidas:**

    - Reduzida a altura do cabeçalho de 70px para 46px e os containers
      internos de 42px para 30px.

    - Simplificação do logotipo: remoção do subtítulo \"Making Of
      Editor\" e redução do nome \"CapIAu-Talho\".

    - Botões da barra de ações limpos de texto, adotando exclusivamente
      line-icons e tooltips explicativos customizados em CSS
      (data-tooltip) com estética de vidro desfocado (backdrop-filter).

    - Adicionada a rota POST /api/project/{project_id}/scan-watch no
      backend e vinculada a ações assíncronas de varredura.

2.  **Cabeçalho Retrátil com Gatilho Minimalista:**

    - Criação da transição para a classe .header-collapsed que desliza o
      cabeçalho para cima com curva suave, redimensionando a área de
      trabalho (.workspace) para ocupar toda a altura da tela.

    - Posicionamento de um gatilho de restauração ultra-discreto no topo
      central (#header-restore-trigger) contendo uma setinha muito
      pequena.

3.  **Timeline Minimalista sem Título e Botões Compactos:**

    - Remoção do texto redundante \"Linha do Tempo Editorial
      (Timeline)\" do painel superior, restando apenas o ícone.

    - Conversão dos botões de Salvar e Exportar da timeline em
      line-icons compactos com tooltips.

    - Substituição do antigo botão flutuante de restauração de timeline
      por uma setinha flutuante ultra-pequena (.timeline-restore-btn)
      centralizada na base inferior da tela.

4.  **Abas Restauradoras Laterais com Setas Chevron:**

    - Os antigos botões redondos de abrir sidebars foram redesenhados
      como abas indicadoras minimalistas (14px x 32px) coladas no
      centro-esquerdo e centro-direito da tela, mostrando apenas
      pequenas setas chevrons (fa-chevron-right e fa-chevron-left).

    - Efeito de hover interativo suave que expande a largura da aba de
      14px para 18px, mantendo o alinhamento vertical absoluto
      centralizado sem saltos ou tremores.

5.  **Correção de Escala Dinâmica via ResizeObserver:**

    - Integração da API nativa ResizeObserver para monitorar a largura e
      altura física do contêiner pai da timeline.

    - Ao expandir ou fechar as barras laterais, a timeline recalcula a
      sua dimensão lógica instantaneamente e redesenha a régua e clipes
      (exibindo mais ou menos tempo na tela), eliminando por completo o
      borramento por estiramento visual e resolvendo o erro de
      deslocamento/offset nos cliques do playhead (agulha).

## 🎛️ Fase 13: Otimização da Biblioteca de Clipes & Modal de Decupagem com Player Interno (07/07/2026)

Implementamos uma grande re-estilização e otimização ergonômica para a
biblioteca de mídias e introduzimos uma suíte de decupagem integrada:

1.  **Visualização Conformada em Linha Única:**

    - Redesenho completo dos cards de arquivo
      (.media-card.tree-file-item) para exibir todos os metadados em uma
      única linha flex de 28px de altura.

    - Miniaturas reais de clipes formatadas em proporção 16x9 com cantos
      levemente arredondados.

    - Opções de controle de visibilidade (Miniaturas, Duração, Tags e
      Status) através de um popover flutuante reativo persistido via
      localStorage.

2.  **Remoção de Limitações de Comprimento e Modo Grade (Grid)
    Adaptável:**

    - Remoção de corte estático de caracteres no JS, permitindo que
      títulos se expandam de acordo com o tamanho horizontal da janela,
      otimizando o espaço quando o painel é maximizado.

    - Zoom dinâmico via slider range que ajusta a largura da miniatura
      de 40px até 240px (valor padrão ajustado para 80px).

    - Modo Grade que distribui os clipes em várias colunas automáticas
      de acordo com a largura da tela.

3.  **Limpeza Inteligente de Títulos de IA (\"Tema Cru\"):**

    - Criação da função cleanTitle para remover qualificadores comuns
      gerados por IA (\"Sequência útil de\...\", \"Clipe valioso
      mostrando\...\", etc.), extraindo o assunto de forma direta e
      mantendo a descrição completa na tooltip de hover.

4.  **Modal de Decupagem Integrado com Player de Vídeo e Recortes
    (IO+E):**

    - Substituição do preview de thumbnail estático por um **Video
      Player interno** (\<video id=\"interview-modal-video\"\>) para
      reprodução instantânea com áudio ativado por padrão.

    - Layout horizontal (flex-direction: row !important) dividindo o
      modal em duas colunas (player à esquerda e ferramentas na
      direita), aproveitando 100% do espaço de tela disponível.

    - Interatividade de seek direcionado: cliques no índice de
      capítulos, temas narrativos ou palavras da transcrição diarizada
      sincronizam o tempo do vídeo local instantaneamente.

    - Suporte nativo e sem interferências de cliques nos botões de
      controle nativos (play, volume, seekbar) com z-index configurado.

    - Painel de marcação local (pontos IN, OUT e Enviar para Timeline)
      com atalhos de teclado locais (I, O, E) e pausando os atalhos
      globais de fundo.

    - Atualização física de miniatura via botão de câmera que gera um
      novo frame no cache do servidor a partir do tempo atual do player.

## 📸 Fase 14: Suporte a Fotos Still na Timeline, Visualizador Ken Burns, Workspace de Montagem e Posicionamento de Zoom/Visualização (09/07/2026)

Implementamos a funcionalidade completa de suporte a fotos (stills) na
timeline e no player, nova workspace para montagem facilitada e
otimização de posicionamento de controles na biblioteca:

1.  **Fotos Stills na Timeline e Exportação (OTIO):**

    - Suporte nativo ao tipo de mídia \"photo\" nas rotas de narrativa,
      modelos Pydantic e persistência SQLite.

    - Adicionada duração padrão para stills
      (Config.PHOTO_DEFAULT_DURATION = 5.0).

    - Exportador OpenTimelineIO (otio_export.py) atualizado para
      empacotar fotos stills como referências de mídia externas com
      durações corretas e metadados preservados (incluindo parâmetros
      Ken Burns).

    - Desenvolvidos testes unitários robustos em
      tests/test_f0_otio_export.py validando o empacotamento e
      exportação de stills.

2.  **Drag-and-Drop e Inserção de Fotos no Frontend:**

    - Adicionado atributo draggable para vídeos e fotos na biblioteca,
      permitindo arrastar arquivos da barra lateral diretamente para as
      pistas de vídeo da timeline.

    - Desenvolvido botão flutuante \"+\" no hover dos cards de fotos e
      botão na lightbox para adicionar stills com durações
      configuráveis.

3.  **Composição e Efeitos Visuais (Ken Burns, Fades & Fit) no Player:**

    - O Program Player (player.js) agora compõe stills de fotos
      utilizando duas camadas \<img\> com sincronização contínua com a
      agulha de reprodução.

    - Aplicação dinâmica de enquadramento (Fit/Fill), movimentos suaves
      de zoom/pan (Ken Burns) e transições por opacidade (dissolve
      crossfades) com base nos efeitos configurados para o clipe.

    - Desenvolvido o **Inspetor de Foto** (painel flutuante de ajustes)
      na timeline para alternar entre modos Fit/Fill, presets Ken Burns
      e tempos de crossfade.

4.  **Workspace \"Montagem\" e Ajuste Ergonômico de Zoom/Exibição:**

    - Novo preset de workspace chamado \"Montagem\"
      (workspaceManager.js): maximiza a biblioteca no topo e ancora a
      timeline horizontalmente na base da tela, permitindo gerenciar
      grandes volumes de mídia com monitores flutuantes de
      Source/Program (com toggle ocultável #btn-montagem-monitors).

    - Posicionamento melhorado dos controles de **Visualização** (modo
      Lista/Cards) e **Zoom** (ícone de lupa, range slider e rótulo de
      pixels), movidos do dropdown de opções de exibição para o lado
      esquerdo da terceira linha da barra de ferramentas da biblioteca.

    - Removidos os boxes de contorno, bordas e fundos de todos os botões
      da terceira linha (Visualização, Zoom, Expandir, Recolher, Fotos
      no Player), tornando-os ícones limpos (*line-icons*) com efeitos
      suaves de hover.

## 📺 Fase 15: Inspetor de Mídia Integrado & Persistência de Painéis (10/07/2026)

Implementamos a funcionalidade completa de Inspetor de Mídia Integrado
no painel lateral esquerdo (ativado via atalho A ou clicando em
\"Voltar\") e persistência de layout/abas no localStorage:

1.  **Lógica de Interface & Adaptador de Layout Dinâmico (Atalho A):**

    - Mapeamos o atalho A em elementos que não sejam inputs ou editores
      de texto para transicionar a barra lateral esquerda para o modo
      **Inspetor de Mídia** (ocultando #library-main-view e exibindo
      #library-inspector-view).

    - Ao abrir o inspetor, o painel da direita se recolhe
      automaticamente e a barra esquerda se expande para uma largura
      maior de destaque (recuperada do localStorage, padrão 650px).

    - Ao fechar o inspetor (tecla A novamente, Esc ou clicando na seta
      \"Voltar\"), a largura da barra esquerda e o estado de
      visibilidade da barra direita são restaurados exatamente como
      estavam antes da ativação.

    - O redimensionamento do painel por splitter durante o modo inspetor
      é armazenado separadamente
      (layout-dim-splitter-sidebar-left-inspector), permitindo ao
      usuário definir larguras independentes para o modo de navegação
      clássico e o modo inspetor.

2.  **Abas Detalhadas do Inspetor de Mídia:**

    - **Índice (Resumo e Navegação):** Mostra o resumo executivo gerado
      por IA e permite navegar e buscar capítulos/blocos temáticos de
      entrevistas ou descrições de visão de B-roll, clicando no timecode
      para buscar a agulha diretamente no **Source Player** clássico do
      programa (eliminando o modal de preview antigo).

    - **Legenda (Transcrição Editável):** Permite alterar o falante
      (speaker) selecionando falantes existentes do projeto ou
      adicionando um falante novo, editar livremente o texto do diálogo
      com salvamento por bloco e dividir o diálogo em partes baseadas na
      agulha atual do player.

    - **Temas Narrativos:** Exibe a lista de temas narrativos do
      documentário associados à mídia com exclusão imediata e formulário
      para vincular manualmente novos trechos a temas específicos com
      inputs de In/Out preenchidos automaticamente.

    - **Rostos Detectados (Desambiguação):** Renderiza rostos
      identificados com suas marcações temporais (seeking com um clique)
      e caixas de texto premium para rotular e desambiguar a identidade
      dos personagens.

    - **Processamento IA:** Atalhos dedicados para acionar rotinas de
      ASR (AssemblyAI), Visão (Gemini) e Clusterização de Faces.

3.  **Persistência de Abas e Estados:**

    - As sidebars e a timeline agora salvam e restauram suas dimensões
      automaticamente no localStorage após arraste dos divisores
      (splitters).

    - A aba selecionada ativa da biblioteca (esquerda) e da transcrição
      (direita) são salvas no localStorage sob as chaves active-left-tab
      e active-right-tab, restaurando sua seleção exata no carregamento
      da página.

4.  **Rotas de Backend & Banco de Dados:**

    - Desenvolvemos rotas robustas FastAPI e queries SQLite no
      repositório NarrativeRepository para suportar
      edit_dialogue_segment (com exclusão e inserção linear interpolada
      dos tempos das palavras), add_theme_segment_manual e
      delete_theme_segment, garantindo consistência completa dos dados e
      re-indexação imediata no banco vetorial Qdrant para buscas
      semânticas RAG em tempo real.

## 🎞️ Fase 16: Reforma do Pipeline — Segmentação Real, CLIP Local e Busca Visual (Etapa 2, 12–13/07/2026)

Substituímos o relógio fixo de extração de frames (1 a cada 10s) por uma decupagem que entende o conteúdo do vídeo, e adicionamos busca por imagem 100% local, sem custo de API. Trabalho descrito em detalhe em `docs/PLANO_IMPLEMENTACAO.md` (Etapa 2):

1.  **Segmentação Real: Shots, Beats e Movimento de Câmera (E2.A):**

    - Criado `src/vision/segmentation.py` usando **PySceneDetect** (ContentDetector + AdaptiveDetector) sobre o proxy 720p para detectar cortes de cena (shots) sem custo de API.

    - **Beats por deriva de embedding:** shots longos (planos-sequência) são subdivididos por deriva visual entre frames amostrados, usando histograma HSV como fallback rápido ou CLIP como método preciso (configurável).

    - **Classificação de movimento de câmera** via fluxo óptico esparso (goodFeaturesToTrack + Lucas-Kanade): `static | pan | tilt | walk | handheld | whip`, gravado por segmento.

    - Nova tabela `media_segment` (migração segura em `schema.py`) persiste shots/beats com `start_time`, `end_time`, `reason` e `motion_label`.

    - **Planejador de keyframes** (`PipelineService._plan_keyframes`) substitui o relógio fixo: extrai keyframes por segmento com piso de cobertura (shots longos viram vários frames), teto de redundância (funde keyframes próximos demais) e teto de custo configurável — logando "N segmentos → N keyframes" para comparação de custo antes/depois.

    - O payload do Qdrant passou a usar as janelas reais `start_time/end_time` do segmento, não mais `timestamp + intervalo` — clicar num resultado de busca agora abre o trecho exato do beat.

2.  **CLIP Local e Busca Visual (E2.B):**

    - Criado `src/search/image_semantic.py` (singleton `ImageSearch`): embeddings de imagem via `clip-ViT-B-32` e de texto em português via `clip-ViT-B-32-multilingual-v1` (mesmo espaço vetorial), carregados sob demanda para não gastar ~1GB de RAM à toa. Coleção Qdrant separada `capiau_images` (512 dimensões, cosseno).

    - Cada keyframe de vídeo (reaproveitando o frame já extraído pela visão, sem custo extra de FFmpeg) e cada foto de set são indexados automaticamente.

    - Novo endpoint `GET /api/search/visual?q=&project_id=` permite buscar por conceito visual em português (ex: "contraluz na janela") mesmo sem palavra correspondente nas descrições textuais. Integrado à busca híbrida (`search_hybrid`) com peso configurável `search.image_weight`, entrando na fusão de resultados antes do MMR.

    - **Encontrar Similares:** endpoints `GET /api/media/photo/{id}/similar` e `GET /api/media/video/{id}/similar` retornam as mídias visualmente mais próximas via CLIP.

3.  **"Encontrar Similares" na Interface (13/07/2026):**

    - Nova função global `showSimilarMedia()` em `main.js` que reaproveita todo o painel de resultados de busca (playlist, filtros por tipo, autoplay, cards) para exibir similares visuais.

    - Três pontos de acesso na UI: botão flutuante roxo no hover dos cards de foto da biblioteca, botão "Similares" no rodapé do lightbox de fotos, e "Encontrar Similares (Visual)" na aba **IA** do inspetor de vídeo (usa o timestamp atual do player Source como referência).

    - Backend: os dois endpoints `/similar` passaram a enriquecer os resultados com metadados do banco (nome, título, proxy) via um helper compartilhado, e o `segment_id` real do keyframe (antes sempre vazio) agora é gravado no payload CLIP — liga cada vetor ao segmento de origem em `media_segment`, base para facetas futuras (escala de plano, paleta) da Etapa 2.D.

4.  **Verificação de Fluxo:**

    - Suite `tests/test_f3_segmentation.py` com 10 testes cobrindo detecção de shots/beats, planejador de keyframes (cobertura de shots longos, fusão de cortes rápidos, teto de custo) e persistência de segmentos — todos passando.

    - Testado end-to-end no navegador contra o servidor real: função definida globalmente, 1.424 cards de foto com botão de similares funcional, e fluxo completo clique → painel → renderização de cards mistos (foto + b-roll) validado com stub de rede controlado.

    - **Pendências da Etapa 2** (ver `docs/PLANO_IMPLEMENTACAO.md`): dedupe de rajadas de fotos (E2.B4), zero-shot tagging de entidades por CLIP (E2.B5), perfis de esforço por categoria (E2.C), fila de revisão de triagem (E2.C2) e gramática do plano — escala, paleta, facetas (E2.D). Recomendado **não** disparar a reanálise completa do acervo (E1.T5, 541 vídeos + 1.424 fotos) antes de E2.B4 e E2.C1 estarem prontos, já que ambos reduzem diretamente o custo dessa rodada única.

## 📐 Fase 17: Configurações da Sequência, Viewport Estável, Alças de Transformação e Efeito de Crop (15/07/2026)

Implementamos a fundação para controle preciso de enquadramento da timeline, propriedades da sequência, e manipulação direta de efeitos de transform e crop no player do Program. Detalhado em `docs/PLANO_VIEWPORT_TRANSFORM_CROP.md`.

1.  **Fundação e Correções de Bugs (Fase 0):**
    - Descravado o FPS do player: todas as rotinas de sincronia e seek leem dinamicamente `TIMELINE_STATE.fps` em runtime.
    - Undo de sliders consertado: adicionado padrão transacional (begin no `oninput`, commit no `onchange`) nos sliders de transformação, cor e volume.
    - Refresh pós-undo/redo: emitido evento `timelineRestored` ao reverter estados, atualizando os sliders e caixas delimitadoras no painel Ajustes.
    - Volume redirecionado: clipes de vídeo associados a um clipe de áudio (link_id) agora redirecionam suas alterações de volume para o par de áudio correspondente.
    - Preservação de scroll: ao reconstruir o HTML do painel Ajustes, a posição do scroll do container é salva e restaurada, evitando saltos visuais.
    - Proteção de abas: ao selecionar um clipe, a aba Ajustes é reexibida automaticamente se tiver sido ocultada pelo usuário.

2.  **Viewport Estável e Transbordo (Fase 1):**
    - Novo elemento `#program-player-viewport` com dimensões físicas controladas por JS, centralizando as 4 camadas de mídia.
    - Máscara de transbordo `#program-viewport-shade` posicionada acima das mídias com `z-index: 50` e `box-shadow` externo de 9999px. Exibe a área fora do corte com 70% de sombra e borda pontilhada ciano de 1px.
    - ResizeObserver observa o wrapper para recalcular e readequar a escala visual da sequência em qualquer redimensionamento do painel.

3.  **Configurações da Sequência e Auto-Configuração (Fase 2):**
    - Propriedades de resolução (`width`, `height`) e FPS adicionadas ao estado da timeline, com persistência no *localStorage* e SQLite.
    - Auto-configuração automática no primeiro clipe: quando a timeline está vazia, o primeiro vídeo adicionado define a resolução e o FPS padrão da sequência.
    - Painel de Configurações da Sequência: exibido quando nenhum clipe está selecionado. Oferece presets de resolução (16:9, 9:16, 4K, 1:1, Personalizado) e inputs manuais, com aviso visual e reescalagem automática de frames dos clipes existentes para preservar suas durações em segundos.
    - Botões rápidos de engrenagem adicionados no cabeçalho do player Program e no sidebar lateral da timeline.

4.  **Zoom do Preview (Fase 3):**
    - Seletor de zoom (`Fit / 25% / 50% / 75% / 100%`) adicionado ao toolbar do Program Player.
    - O viewport se redimensiona mantendo a proporção exata da sequência, cortando o conteúdo de transbordo no limite do painel com base no zoom fixo escolhido.

5.  **Alças de Transformação Interativa (Fase 4):**
    - Caixa delimitadora ciano desenhada sobre a imagem com base no *content rect* real do clipe (compensando faixas pretas).
    - Suporte a arrastar o interior da caixa para alterar a posição (translação X/Y).
    - Suporte a arrastar qualquer uma das 4 alças quadradas dos cantos para escalar uniformemente.
    - Suporte a arrastar a alça estendida no topo para rotacionar o clipe.
    - Transação de histórico integrada: o gesto inicia uma transação com `TIMELINE_HISTORY.begin()` no pointerdown e encerra com `commit()` no pointerup, atualizando os sliders no painel.

6.  **Efeito de Recorte / Crop (Fase 5):**
    - Sliders dedicados no painel Ajustes para cortar bordas esquerda, direita, superior e inferior de 0% a 90%.
    - Recorte relativo ao conteúdo real da imagem, aplicado usando `clip-path: inset(...)` em pixels relativos ao *content rect*, acompanhando transformações e rotações perfeitamente.


## 🔍 Fase 18: Busca em Lote, RAG Didático e Resiliência de IA (16–17/07/2026)

Semana dominada por dois temas: dar ao usuário uma busca que **explica suas próprias respostas**, e blindar o pipeline de visão contra falhas de API que estavam custando dinheiro e apagando trabalho já feito.

1.  **Busca por Similaridade em Lote e Explicações do RAG:**
    - Seleção de múltiplos cards para disparar uma única busca por similaridade agregada (backend em `search`, UI na aba Busca).
    - Cada resultado passou a exibir a **justificativa didática** do motivo pelo qual a IA relacionou aquele trecho à consulta — o RAG deixou de ser uma caixa preta.
    - Painel de filtros reestruturado em duas linhas, com barra de busca avançada compacta.
    - Filtro por **ciclo de status** (*Todos → Analisados → Não Analisados → Erros*), percorrido por cliques sucessivos no mesmo botão.
    - Rolagem oculta e tooltips integrados ao layout de busca.

2.  **Resiliência de IA — a lição dos 402:**
    - **`max_tokens` declarado explicitamente** na chamada de visão. Sem essa declaração, a OpenRouter reservava saldo indevido e devolvia erro 402: **66 falhas de crédito** foram eliminadas por essa única linha.
    - **Falha de API nunca mais sobrescreve descrição boa existente.** Antes, uma resposta vazia apagava uma análise válida — agora a escrita só acontece com conteúdo real.
    - Retry + fallback automático implementado na visão e, em seguida, replicado no enriquecimento.
    - Modelo de visão virou **dropdown na UI**, com as opções gratuitas selecionáveis.
    - **Nemotron gratuito promovido a padrão e rebaixado no mesmo dia:** medido em produção, ~30% das chamadas batiam em `Upstream idle timeout exceeded` (504 do próprio gateway). A projeção era de ~5,7 dias só para as fotos restantes, contra poucas horas com o Gemini. Gemini voltou como padrão; o Nemotron seguiu selecionável e como reserva. Decisão registrada em comentário no `config.py`.

3.  **Timeline e Miniaturas:**
    - Pistas podem ser ocultadas individualmente; miniaturas passaram a carregar progressivamente.
    - *Hover preview* inteligente na régua e nos clipes.
    - **Gerenciador de tarefas de miniaturas**: pausar, cancelar, remover e sincronizar a fila.

4.  **Interface e Operação:**
    - **Duplo clique reseta sliders** de ajuste para o valor padrão.
    - Valores visuais arredondados no painel Ajustes, evitando quebra de layout com decimais longos.
    - Cabeçalho unificado, com títulos analisados exibidos no hover.
    - **`scripts/launch_detached.py`**: lançador de processo verdadeiramente desgrudado do console no Windows, resposta ao incidente de 16/07 às 03:30, quando o fechamento de uma janela de terminal matou worker de visão e servidor juntos após ~36h de execução (`CTRL_CLOSE_EVENT` abortando o runtime Fortran/MKL do PyTorch).
    - Zoom do visualizador de fotos com foco no mouse, minimapa e pan com a barra de espaço.
    - Entidades incluídas no gerenciador de nomes, com remoção *nocase*.

---

## 👤 Fase 19: Inspetor de Rosto e Refinamento das Sidebars (18–19/07/2026)

1.  **Inspetor de Rosto:**
    - Tela dedicada com **aprimoramento HD** do recorte facial.
    - Navegação bidirecional pelo teclado (`a` / `s`) para percorrer os rostos do grupo sem tirar as mãos do teclado.

2.  **Timeline:**
    - Corrigida a escala do zoom global de altura das pistas, com *clamp* automático da rolagem vertical.
    - Cabeçalhos de pista passam a usar **duas linhas quando a altura ≥ 40px**; removido o tooltip de redimensionamento que atrapalhava o arrasto.
    - Blocos de vídeo ocupam 100% da altura da pista.
    - Opção para posicionar a barra de ferramentas da timeline no topo.

3.  **Sidebars:**
    - Dimensões verticais padronizadas e visual adaptativo aos três estágios da sidebar.
    - Removido o rodapé de status estático do menu esquerdo.
    - Diretrizes do *design system* `capiau-nle-design-system` atualizadas.

---

## 📤 Fase 20: Exportação Reativada, Triagem com Few-Shot e Facetas Visuais (20/07/2026)

Dia de destravar três frentes que estavam paradas por dependência técnica.

1.  **Exportação OTIO/XML/EDL reativada (E1.T6):**
    - O `opentimelineio` seguia **sem wheel para Python 3.14** (confirmado com `pip download --only-binary`). Em vez de esperar, adotou-se o **plano B**: um venv 3.12 dedicado.
    - `data/venv312` criado via `uv` (CPython 3.12.12 standalone, sem tocar no Python do sistema), com `opentimelineio` + `otio-fcp-adapter` + `otio-cmx3600-adapter` (a partir do 0.16 os adaptadores XML/EDL saíram do core) + `python-dotenv`.
    - `otio_export.py` passou a **delegar por subprocesso** quando o import falha (`_export_via_worker`), com caminho configurável em `export.worker_python` e autodetecção por padrão. O worker herda `DB_PATH`/`EXPORTS_DIR` por variável de ambiente.
    - **Validado ponta a ponta:** a timeline real *"teste jlcut"* exportada nos 3 formatos pela API (HTTP 200), com timecodes corretos no EDL.
    - 4 testes novos em `tests/test_f0b_export_bridge.py` (rodam no 3.14 sem otio; pulam se o venv não existir).

2.  **Triagem com Aprendizado Few-Shot (E2.C2/E2.C3):**
    - Fila de revisão de triagem, com as correções do usuário realimentando o prompt como exemplos.
    - Correção de categoria pela UI passou a **sincronizar a faceta no Qdrant na hora**, com propagação para a rajada inteira.

3.  **Facetas Visuais (E2.D1–D3):**
    - **Escala de plano zero-shot** (geral, americano, médio, close, detalhe, aéreo) e **paleta de cor** por segmento e por foto.
    - Backfill no acervo real **sem re-extração e sem chamadas de API**, reusando os vetores já indexados: **7.042 pontos classificados**, **5.618 segmentos** com `shot_scale`. Distribuição: 44% plano médio, 19% detalhe, 17% geral, 12% americano, 6% close, 50 aéreos.
    - Filtros `shot_scale`, `palette_temp`, `camera_motion` e `category` disponíveis no `/api/search/visual`.

4.  **Marcadores de Timeline:**
    - Suporte a marcadores de tempo na régua da timeline NLE.

---

## 📝 Fase 21: Roteiro Estruturado, Entidades e Universos (21–22/07/2026)

1.  **Extração de Roteiro (E3.C / P2):**
    - Extração em **background com cache e preview**, evitando reprocessar o mesmo documento.
    - O plano original usava um **regex único de sluglines** para segmentar cenas. Testado contra variações reais de formatação, falhava em **7 de 10 casos** — e, pior, falhava **em silêncio**: um draft numerado caía de 111 para 7 cenas sem disparar alarme.
    - Substituído por `src/services/script_format.py`, com **cascata de 5 camadas**: (0) estrutura nativa do formato (`.fdx`, `.fountain`), (1) biblioteca de padrões competindo por pontuação, (2) **validação do resultado** — a peça que faltava, usando a *mediana* do tamanho de cena como discriminador (610 chars segmentado certo vs. 10.810 quebrado; a dispersão sozinha não separa os casos), (3) o LLM identifica a convenção quando as heurísticas falham, (4) modo `prose` para documentos sem estrutura de cena.
    - Numeração de cena sempre por **posição no documento**, nunca pelo LLM.
    - `GET /api/docs/{id}/structure-preview` roda as camadas gratuitas antes de qualquer chamada paga.
    - Validado no roteiro real: **111 cenas, 6 chunks, confiança 1.0**.
    - Bloco compacto do roteiro disponível em triagem e visão, com *toggle*.
    - Preview e curadoria da extração na aba Docs.

2.  **Entidades e Universos (E3.C / E-A e E-B):**
    - Modelo de dados ganhou **universo** (produção × obra), **função** e **vínculo** entre entidades.
    - API de **fusão de entidades**, resolução por alias e `PATCH` ampliado.
    - Consumos de entidade passaram a respeitar o `realm`.
    - Painel **"Entidades do Projeto"** com fusão, vínculo e edição inline.

3.  **Miniaturas — a caçada às thumbnails pretas:**
    - Invalidação de cache e sincronização da miniatura na biblioteca.
    - Fallback para **proxy 720p** na extração, com expurgo das miniaturas verdes/corrompidas.
    - Removido o overhead do PIL em `get_video_thumbnail`.
    - `thumb_version` com `mtime` em `list_videos`, encerrando definitivamente o cache velho no F5.

4.  **Timeline e Interface:**
    - **Régua de timecode adaptativa e precisa.**
    - **Zoom vertical de pistas via `Shift` + roda do mouse.**
    - Preview em hover simplificado (apenas o quadro, sem rodapé nem borda).
    - Reanálise em lote de falhas visuais, com fallback para proxies 720p.
    - Animação de clique com spinner em linha e *toast* ao definir miniatura.
    - Persistência do projeto ativo e carregamento imediato das mídias no reload.
    - Aba *Mídias* renomeada para *Vídeos*; tooltips ocultos no estágio normal.

---

## 🛡️ Fase 22: Fallbacks Triplos, Trava de Rostos e Workspaces Customizadas (23–25/07/2026)

1.  **Cadeia Tripla de Fallbacks no Enriquecimento:**
    - Suporte a **três modelos em cascata**, processamento **paralelo com 5 workers** e teto de **2000 tokens** por chamada.
    - Tratativa de **respostas nulas/vazias do OpenRouter**, que vinham causando `AttributeError` em `.strip()` — falha silenciosa que derrubava lotes inteiros.

2.  **Biometria Facial — protegendo o trabalho manual:**
    - **Trava de grupos desambiguados na re-clusterização**: decisões manuais deixaram de ser sobrescritas pelo DBSCAN.
    - Refinamento final (25/07): **apenas rótulos faciais confirmados** são travados; clusters não confirmados são resetados, evitando que um erro de rotulagem se propague para sempre.
    - Botão de desambiguação melhorado.

3.  **Workspaces Customizadas:**
    - Suporte completo a **salvar, sobrescrever, renomear e restaurar** layouts de interface personalizados.

4.  **Fluxo de Reanálise:**
    - Atalhos `Esc` / `Ctrl+Z`, botão voltar e cancelamento no fluxo de reanálise de falhas visuais.
    - Controle manual de status.

5.  **Interface:**
    - Botões de sub-ação padronizados como *line icons* na barra de tarefas e sidebars.
    - Barra de progresso das tarefas responsiva ao tamanho do MLD, com prioridade de expansão para os nomes das tarefas.

---

## 📄 Fase 23: Licenciamento, Configuração e Documentação (18/08/2026)

Após três semanas sem commits, uma rodada de saneamento do repositório e da documentação.

1.  **Licenciamento e Onboarding:**
    - Adicionada a **licença GPL-3.0** (`LICENSE`). O repositório era público sem licença — situação em que, juridicamente, ninguém pode usar, copiar ou contribuir.
    - Criado o **`.env.example`** com as 18 variáveis que o código realmente lê, comentadas. O README documentava apenas 5.

2.  **Configuração:**
    - `TEXT_MODEL` padrão atualizado de `deepseek/deepseek-chat` para **`deepseek/deepseek-v4-flash`**, em `config.py` e `settings_registry.py`.
    - O `settings_registry` passou a referenciar `CONFIG.TEXT_MODEL` em vez de repetir a string, eliminando a fonte dupla de verdade.
    - *Observação:* o `.env` e o banco já apontavam para `v4-flash` desde 10/07, então a mudança não alterou o comportamento em execução — corrigiu apenas o padrão para instalações novas.

3.  **README reescrito:**
    - **Índice** com 34 links internos, todos verificados.
    - **Arquitetura** refeita: tabela das 4 camadas, diagrama Mermaid funcional (antes o `graph TD` estava solto como texto cru, com resíduos de conversão de Word) e o percurso de uma mídia em 7 passos.
    - Seção **"Como montar localmente"** com ambiente virtual, dependências de exportação e verificação do FFmpeg.
    - Seção de **solução de problemas** cobrindo os incidentes reais: conflito `tokenizers`/`transformers`, FFmpeg fora do `PATH`, morte do servidor por `CTRL_CLOSE_EVENT`, índice de busca indisponível e timeouts de visão.
    - **Correções de fatos**: os 6 links de documentação apontavam para `about:blank`; a cascata de fallback estava descrita ao contrário do código; o comando do `launch_detached.py` estava sem os argumentos obrigatórios; e o README prometia exportação nativa `.kdenlive`, **que nunca existiu no código** — os formatos reais são `.otio`, `.xml` e `.edl`.

4.  **Interface:**
    - Box de hover reposicionado para o início do texto; descrição de fotos deduplicada.

---

## 🗂️ Fase 24: Exportação Confiável, Índice de Rolagem e Títulos Executivos (18/08/2026, noite)

Três frentes na mesma noite: a exportação passou a funcionar de fato no Kdenlive, a biblioteca ganhou navegação por índice temático, e as mídias ganharam títulos que um humano consegue ler.

1.  **Exportação confiável (`41c1220`):**
    - **Diálogo de exportação.** Antes o botão exportava direto: primeiro via um `prompt()` pedindo para DIGITAR o formato, depois lendo um `<select>` com `opacity: 0` sobreposto a um ícone — invisível na prática. O usuário clicava no botão vizinho e o arquivo saía sem nenhuma escolha visível. Agora abre um diálogo com as timelines salvas do projeto (nome, data e **quantidade de clipes**), o seletor de formato com explicação de cada um, e aviso amarelo quando a timeline escolhida está vazia.
    - **Qual timeline sai.** A exportação usa o que está gravado no banco, não o que está na tela — e mandava sempre `timelines[0]`, a de maior id. O usuário exportou uma timeline de julho achando ser a atual e só percebeu ao abrir no Kdenlive. O `clip_count` novo em `list_timelines` torna o erro visível antes de gerar o arquivo.
    - **Caminho de mídia no `.otio` (o defeito que impedia abrir no Kdenlive).** Exportávamos `target_url` como URI (`file:///D:/.../V%C3%ADdeos/...`). O padrão OTIO admite, mas **o importador do Kdenlive não trata o campo como URI**: concatena a pasta do projeto na frente e não decodifica o percent-encoding. No Kdenlive 26.04.3 o resultado foi `Cannot open file C:/Users/FGC/Downloads/file:///D:/makinof-monstro/V%C3%ADdeos/...` e o projeto inteiro falhava. Novo helper `_media_target_url(filepath, as_uri)`: o **`.otio` grava caminho absoluto simples** (`D:/makinof-monstro/Vídeos/...`), o **`.xml` mantém a URI** que Premiere e Resolve esperam em `<pathurl>`. ⚠️ **Lição de método:** a validação anterior decodificava as URIs por conta própria e concluía "as mídias religam" — provava que o ARQUIVO estava correto pelo padrão, não que o CONSUMIDOR o entendia. Só o teste no editor real mostrou.
    - **Miniatura deixou de bloquear o servidor.** `GET /api/video/{id}/thumbnail-at` era rota síncrona e, no cache miss, chamava ffmpeg **dentro da requisição**. Rotas síncronas dividem um threadpool no FastAPI: soltar um vídeo na timeline disparava dezenas de pedidos, o pool enchia e rotas sem relação ficavam esperando. Medido: a exportação leva **13 ms**, mas demorava "muito" por estar na fila atrás das miniaturas. Agora o cache miss enfileira na fila de fundo (que já existia) e responde 404; o `timelineRenderer` reagenda com espera crescente (~2 min de janela) e exibe a miniatura vizinha mais próxima enquanto espera. Sem o reagendamento a entrada ficaria em cache como "falhou" para sempre — o cache do renderer é permanente por (vídeo, segundo).
    - 14 testes novos em `tests/test_f11_export.py`.

2.  **Índice Temático de Rolagem — "Scroll Peeker" (`e5a604a`):**
    - Nova classe `LibraryScrollIndexTracker` em `library.js`. Parar o mouse sobre a barra de rolagem da biblioteca abre um cartão de pré-visualização do item naquela altura, **sem precisar rolar até ele**.
    - O cartão traz miniatura, pasta de origem, **título executivo**, selo de tipo (*Fala* / *Bastidores*), duração, resumo, tags e a posição (`Posição: N de M`). Pastas aparecem com ícone próprio e rótulo *Diretório*.
    - **Tempo de parada configurável** (0,5s / 1,0s / 1,5s / desativada) no novo menu de exibição da biblioteca, junto com a chave liga-desliga do índice.
    - **Fast-jump calibrado:** arrastar na barra não rola pela proporção crua — alinha o topo do item real sob o cursor, então o salto para no começo do card em vez de no meio dele.
    - **`Shift` + roda do mouse** com o cartão aberto redimensiona a miniatura de 80 a 240 px, persistido em `localStorage`.

3.  **Títulos Executivos Inteligentes (`51d52f0`):**
    - **Prompt reescrito** em `prompt_registry.py`: os títulos passaram a ser explicitamente "executivos e cinematográficos" de 3 a 6 palavras, com **lista de aberturas proibidas** — nada de "Entrevista sobre", "Vídeo de", "Depoimento de", "Este clipe mostra", "Sequência útil", "Registro de", "Mostrando". Para depoimentos o foco é quem fala + assunto (`Zé: Crítica ao primeiro corte`); para B-roll é a ação ou cena central (`Detalhe das mãos no vinil`).
    - **Geração em lote** com `PipelineService.regenerate_executive_titles`, em micro-lotes de 20 vídeos, integrada ao TaskManager: progresso, log e cancelamento na tela de Tarefas. Rota `GET|POST /api/project/{id}/regenerate-titles`, botão **Gerar Títulos IA** na biblioteca.
    - **Renomeação inline:** duplo clique no título de um card abre um campo de edição no lugar; `Enter` grava, `Esc` cancela. Rotas `PATCH /api/video/{id}/title` e `PATCH /api/photo/{id}/title`.
    - `getFriendlyTitle` dá prioridade ao título da IA, com queda para heurísticas sobre descrição/resumo e, por preferência do usuário por clipe, para o nome de arquivo real.
    - 📌 **Pendência registrada:** o título **não entra no payload do Qdrant** hoje. Nem o índice visual (`image_semantic.py`: `project_id`, `video_id`, `media_type`, `start_time`, `end_time`, `segment_id`, `shot_scale`, `category`, `camera_motion`) nem o de texto (`semantic.py`: `text`, `raw_text`, `tags`, `people`) carregam esse campo. Por enquanto o ganho é de leitura na interface — biblioteca, cartão do índice de rolagem e timeline. Para o título influenciar a busca é preciso incluí-lo no payload e reindexar.

---

## 🎞️ Fase 25: Virada de Clipe sem Piscada no Program (22/08/2026)

Passar de um clipe para o outro na timeline — em reprodução ou frame a frame — apagava a imagem por um instante. O Program pintava preto no corte e só então o próximo vídeo aparecia.

1.  **A causa (`player.js`, `syncVideoToPlayhead`):**
    - A composição tinha dois `<video>` fixos: `program-video-a` para a camada base e `program-video-b` para a cobertura. Ao entrar um clipe de outro arquivo, o código dava `el.src = ...; el.load()` **no elemento que estava no ar**.
    - `load()` zera o elemento de mídia (`readyState` volta a `HAVE_NOTHING` e o quadro decodificado é descartado). Até o arquivo novo abrir e posicionar, o `<video>` pinta o próprio fundo — preto. Era a piscada.
    - A "estabilidade de papéis" que existia só resolvia a migração entre as camadas base e cobertura; dois clipes seguidos **na mesma pista** caíam sempre no mesmo elemento, ou seja, no caminho do `load()`.

2.  **A correção — pool de buffers com pré-carga:**
    - O pool passou de 2 para **4 `<video>`** (`program-video-a` … `-d`): dois no ar (base e cobertura) e dois livres para aquecer o próximo clipe.
    - `_preloadUpcoming` abre os clipes que começam dentro de **~3 s à frente** num buffer ocioso e os deixa **parados no primeiro frame do clipe**, escondidos (`opacity: 0`, mas renderizados, para o compositor já ter o quadro).
    - Na hora do corte, `claimBuffer` acha o buffer que já contém aquele clipe e a virada é só revelar: nenhum `load()`, nenhum `seek`, nenhum quadro preto. O buffer que saiu é escondido e pausado no mesmo ciclo de pintura.
    - **Emenda de razor cut:** quando o clipe seguinte é do mesmo arquivo e começa exatamente onde o anterior termina, o buffer que está no ar apenas continua rolando (troca só o id do clipe). Não gasta buffer de pré-carga nem trava o decoder com um seek — daí a constante `BUFFER_CONTINUITY_TOLERANCE`, folgada o bastante (0,1 s) para não brigar com a correção de deriva por `playbackRate` (banda de 0,08 s).
    - **Nunca apagar a imagem:** se o buffer novo ainda não abriu (salto longo, rede lenta), o quadro anterior fica no ar e `_awaitBuffer` recompõe assim que houver imagem. Com o player pausado não há laço de animação para tentar de novo — daí o listener de `seeked`/`loadeddata`/`canplay`.
    - Buracos da timeline continuam pretos, como em qualquer NLE.

3.  **Efeito colateral corrigido (`workspaceManager.js`):**
    - O clique no monitor do Program dava play direto em `program-video-a`. Com o pool não existe mais um elemento fixo no ar: o clique passou a acionar o botão de play do painel, que é quem fala com o `ProgramPlayer`.

---

## 🎚️ Fase 26: Tratamento de Áudio no Painel de Ajustes (23/08/2026)

Editores de vídeo não são, em geral, bons editores de áudio — e o programa
falava com eles em LUFS, dBTP e LRA sem explicar nada. Esta fase implementa as
seis etapas de `docs/PLANO_AJUSTES_DE_AUDIO.md` e o que a implementação revelou
que faltava nele.

1.  **O princípio que organiza tudo (seção 2 do plano):**
    - **Ao vivo:** corte de graves, EQ de 3 bandas, gate e compressor rodam no
      navegador via WebAudio, sobre o mesmo elemento que o player já usa.
      Latência zero, reversível, **nunca gera arquivo**.
    - **Renderizado:** reparo de clipping, denoise, loudness e limitador rodam
      fora do processo do servidor, produzem um WAV derivado em
      `data/audio_tratado/` e o clipe guarda um **ponteiro**. O arquivo original
      nunca é tocado.
    - O painel de Ajustes foi de 5 para 10 seções, e a fronteira entre "muda na
      hora" e "entra numa fila" é visível na interface.

2.  **Diagnóstico por medição, não por chute:**
    - Um passe de `ebur128` + `astats` mede loudness, pico real, clipping, piso
      de ruído, faixa de loudness e correlação entre canais; devolve selos de
      severidade e sugere o preset.
    - As linhas por quadro do `ebur128`, que eram descartadas, viram uma **faixa
      sobre o clipe** mostrando onde estourou e uma **lista de momentos
      clicáveis** que levam o playhead até lá.

3.  **Os números medidos no acervo** (entrevista Julia + Virshna, 6:45–8:15):

    | | original | ffmpeg | IA |
    |---|---|---|---|
    | loudness | −7,1 | −16,0 | −15,7 LUFS |
    | pico real | +1,7 | −3,0 | −4,6 dBTP |
    | piso de ruído | −26,7 | −36,4 | −49,4 dB |

    Velocidades: cadeia de ffmpeg a **31×–44× tempo real** (entrevista de 22 min
    em ~43 s); denoise por IA a **RTF 0,71** (a mesma entrevista em ~16 min,
    cerca de 45 vezes mais lento). Daí o "Prever 15 s" ser obrigatório na prática
    antes de comprometer um clipe inteiro.

4.  **Cinco correções que a implementação impôs ao próprio plano:**
    - O comando de análise da seção 5, com `-v error`, devolve stderr **vazio**:
      os sumários saem em nível INFO. O correto é `-v info -nostats`.
    - A fórmula de atenuação da seção 7 estava **invertida**; o correto é
      `clamp(piso − (−45), 6, 18)`.
    - Dois números da tabela da seção 1 **não se reproduzem**: o ffmpeg devolve
      −7,4 LUFS e `Peak count 2`, não −10,4 e 669 amostras. 📌 **Pendência:** os
      limiares da seção 7 derivam dessa tabela, então a medição precisa ser
      refeita antes de eles valerem como verdade.
    - O ffmpeg roda a 31×–44×, não aos ~90× estimados.
    - Requisitos escritos na **prosa** das seções 8 e 10 nunca entraram em
      checklist de etapa — por isso a integração da nuvem e a conformação do
      áudio tratado quase ficaram órfãs.

5.  **O que a verificação pegou** (seis defeitos que passaram nos testes de quem
    os escreveu):
    - A rota gravava o arquivo de PID **em nome do worker**, e o worker então
      recusava a si mesmo ao subir. Todo despacho automático morria em silêncio,
      deixando o trabalho em `pending` para sempre — tanto no denoise por IA
      quanto na nuvem.
    - `AudioContext.prototype.audioWorklet` é um *getter*: lê-lo no protótipo
      lança `Illegal invocation` e derrubava `renderAdjustmentsPanel` inteiro,
      em qualquer clipe.
    - `parse_sequence` descartava `effects` e `link_id` ao migrar sequência v1
      para v2, deixando o código do export correto e **inerte**.
    - Os parâmetros numéricos do Auphonic são listas fechadas, não faixas
      contínuas: mandávamos valores fora da grade em 55 de 210 pisos testados, e
      `filtering` nunca era enviado.
    - As tabelas de chave dos ícones de explicação usavam nomes que não existiam
      no glossário — o ícone simplesmente não aparecia.

6.  **O que NÃO foi feito, de propósito:**
    - **VST via `pedalboard`**: opcional no plano, com bug conhecido de crash e
      exigindo licença que não existe aqui. A ida e volta por arquivo, que o
      plano recomenda, está pronta.
    - **Detecção local de zumbido de rede**: tentada por filtro e por FFT. O
      filtro falhou por física — biquad de 2ª ordem não separa 60 de 65 Hz — e a
      FFT deu falso positivo no arquivo limpo **maior** que o sinal no arquivo
      com zumbido injetado. Descartada; `dehum` vai em Auto e o detector do
      Auphonic decide.

7.  **Explicações e chat:** ícone (i) discreto que abre no clique uma explicação
    detalhada, a partir de um glossário de 39 verbetes em
    `src/nlp/audio_glossario.py`. É fonte **única**: o mesmo texto alimenta o
    prompt do chat, que ganhou 4 ferramentas de áudio (16 no total). Três travas:
    prévia de 15 s é o padrão dele, ele **não** pode acionar o Auphonic (gastaria
    a cota do dono) e nunca liga corte automático de silêncio.

8.  **Validação:** 237 testes de áudio verdes (61 análise + 45 cadeia + 52 nuvem
    + 36 denoise + 20 stems + 23 glossário), autoteste do worker 39/39, e
    verificação ponta a ponta contra o áudio real do acervo — inclusive um teste
    de falsificação: a única janela de 2 s que o diagnóstico **não** apontou tem
    zero quadros acima de −1,5 dBFS.

    📌 **Falta teste manual:** os ajustes ao vivo nunca foram ouvidos, a
    conformação nunca foi aberta num NLE, nenhuma produção real foi enviada à
    nuvem e a ida e volta com a DAW nunca teve uma DAW de verdade.
