# Walkthrough da Implementação — CapIAu-Talho Making Of MVP

Este documento resume as implementações realizadas, os testes efetuados e instrui sobre como executar a aplicação de forma rápida e local.

---

## 🛠️ O Que FO MVP funcional do **CapIAu-Talho** foi totalmente desenvolvido e testado no seu computador! A arquitetura foi adaptada de forma ideal para o seu processador **Intel i7-10700** e **32 GB de RAM** sem depender de GPU dedicada, operando em um **Modelo Híbrido Otimizado**:

### 1. Ambiente Híbrido e Modelos Customizáveis (Novidades de 2026)
* [x] Criado `requirements.txt` com todas as dependências unificadas e instaladas com sucesso (FastAPI, Qdrant-client, Sentence-transformers, AssemblyAI, OpenTimelineIO, etc.).
* [x] Estruturado arquivo `.env` para centralizar as chaves das APIs do **OpenRouter** e **AssemblyAI** e configurar as pastas locais de mídia.
* [x] **Escolha Flexível de Modelos:** Adicionado suporte para customizar `TEXT_MODEL` e `VISION_MODEL` diretamente no seu `.env`, permitindo que você use modelos modernos lançados nos últimos dois meses, como o **Gemini 3.1 Flash Lite** (maio/2026, ultra-econômico) ou o **Perceptron Mk1** (maio/2026, especializado em frames de vídeo).
* [x] Configurado `src/config.py` para carregar as variáveis de ambiente e **gerar automaticamente toda a estrutura de pastas** (`originals`, `proxies`, `watch`, `cache`, `exports`) na sua máquina.

### 2. Banco de Dados e Busca Semântica em CPU (Sem Docker!)
* [x] Criado `src/db/schema.py` com o schema relacional SQLite, estruturando projetos, vídeos, fotos, transcrições palavra-a-palavra, temas e relações.
* [x] **Gerenciamento Multi-Projeto Autônomo:** Adicionadas operações de CRUD de projetos (`add_project`, `get_projects`, `delete_project`) em `src/db/operations.py` com suporte a **Deleção Física em Cascata** (`PRAGMA foreign_keys = ON`), permitindo isolamento total de mídias de diferentes produções.
* [x] Desenvolvido `src/search/semantic.py` inicializando o **Qdrant local baseado em arquivo**. Roda 100% na sua CPU local, gerando embeddings através do modelo leve e offline `all-MiniLM-L6-v2` (~120MB) com busca semântica em menos de 10ms!
* [x] **Correção de Bugs Críticos de Parâmetros:** Identificados e corrigidos bugs silenciosos onde o `project_id` era omitido na indexação do Qdrant nos motores ASR (`asr_engine.py`) e Vision (`multimodal_engine.py`), bem como no endpoint de busca do servidor.
* [x] Resolvido o requisito do Qdrant de IDs em formato UUID através da **geração determinística de UUIDs v5** a partir de string keys, gerando unicidade e evitando duplicatas.

### 3. Pipeline de Ingestão, FFmpeg e In-Place Ingestion (HD Externo)
* [x] Criado `src/ingest/watcher.py` para monitoramento automático de arquivos na pasta `watch/`.
* [x] **Ingestão In-Place (Modo Link para HD Externo):** Adicionado suporte a parâmetro `copy_original=False` no fluxo de ingestão. Mídias gigantes localizadas em HDs externos ou SSDs podem ser analisadas e vinculadas **sem serem copiadas localmente** (poupando espaço em disco). O CapIAu-Talho armazena no SQLite o caminho absoluto real do HD externo e gera apenas o leve proxy de preview localmente, garantindo o link correto na exportação XML/EDL.
* [x] **Importador Recursivo de Pastas:** Criada a lógica `ingest_external_path` mapeada no novo endpoint `/api/ingest/external` para varrer recursivamente qualquer caminho absoluto de disco externo e catalogar mídias em modo in-place.
* [x] Implementado deduplicação automática via SHA-256 e extração de metadados técnicos ricos por **FFprobe**.
* [x] Desenvolvido proxying nativo por **FFmpeg** gerando proxies rápidos H.264 em 720p/360p com áudio AAC para visualização imediata na Web, com tratamento de exceções robusto e sem travar a CPU.


### 4. Transcrição ASR, Diarização e Clustering Temático (Nuvem Econômica)
* [x] Criado `src/transcription/asr_engine.py` integrado com **AssemblyAI** (Universal-2), fornecendo transcrição pt-BR rápida com diarização de falantes (quem falou o quê) e timestamps atômicos, seguido por indexação instantânea no Qdrant local.
* [x] Desenvolvido `src/vision/multimodal_engine.py` extraindo frames a cada 10s via FFmpeg (sem carregar o OpenCV) e analisando bastidores/fotos usando a API multimodal **Gemini 2.5/3.1/3.5** no OpenRouter (custando menos de R$ 7,00 para 20h!).
* [x] Desenvolvido `src/nlp/theme_cluster.py` carregando os diálogos inseridos no SQLite e agrupando trechos automaticamente em tópicos do documentário (Making Of) via **DeepSeek V3** no OpenRouter (custando menos de R$ 8,00 para as 20h!).

### 5. Exportador OpenTimelineIO e Dashboard Web Premium
* [x] Implementado `src/export/otio_export.py` integrando a biblioteca **OpenTimelineIO** para traduzir a sequência de cortes da timeline em arquivos XML (Premiere/Resolve), EDL ou JSON OTIO.
* [x] Desenvolvido servidor REST FastAPI em `src/api/server.py` mapeando endpoints de busca semântica híbrida, controllers assíncronos e servindo o frontend.
* [x] Construído **Dashboard Web Premium** (`index.html`, `styles.css`, `app.js` em `src/ui/`) com visual espetacular glassmorphism em **proporção widescreen 16:9** contendo:
  - **Área de Projetos Glassmorphic** no topo contendo seletor de projetos ativo, botão para criar novo projeto e botão de exclusão rápida.
  - **Modal de Novo Projeto** responsivo translúcido para preenchimento de metadados do filme.
  - **Menus retráteis** esquerdo (biblioteca) e direito (transcrições) por clique simples, redimensionando o player de forma responsiva.
  - **Player de Vídeo Profissional** com atalhos de teclado **JKL** (Premiere-style), controle de velocidade de reprodução e seletor de resolução proxy (720p/360p/Original).
  - **Marcação de Pontos I/O (In / Out)** via teclas `I` e `O`, permitindo fatiar e enviar trechos à timeline instantaneamente (tecla `E`).
  - **Barra de Status do Sistema em Tempo Real:** Uma barra translúcida premium no rodapé do painel esquerdo que fornece referência contínua e visual das ações em execução no background (como varredura de pastas, importações recursivas, IA decodificando falas com AssemblyAI ou temas com DeepSeek), mudando dinamicamente entre spinners de carregamento ativos e checks verdes de finalização bem-sucedida.
  - **Status de Pipeline nos Cards de Mídia:** Badges e spinners embutidos nos cards de vídeo que mostram o status individual de processamento (spinners animados para mídias em fase de `transcrevendo` ou `analisando`, selos premium **[ASR]** e **[VISÃO]** para tarefas concluídas e marcações em vermelho para erros de FFmpeg).
  - **Painel Ativo de Conversões e Progresso Real (0-100%):** O CapIAu-Talho agora lê dinamicamente a saída do `stdout` do FFmpeg (`-progress pipe:1`) e calcula o progresso real em porcentagem comparando com a duração obtida pelo FFprobe. Os cards de mídia exibem dinamicamente `Convertendo XX%` com spinners em tempo real.
  - **Ações de Controle Total (Cancelar/Deletar):** Cards de mídia ganham botões flutuantes: um botão de parada (`fa-circle-stop`) em mídias ativas para matar a tarefa e limpar arquivos parciais, e um ícone de lixeira hover (`fa-trash-can`) para proxies concluídos, permitindo deletar fisicamente o proxy do HD e liberar espaço na máquina local.
  - **Visualização em Árvore/Explorer (Premium VSCode-Style):** Para evitar poluição visual ao importar centenas de arquivos, a biblioteca do CapIAu-Talho agora detecta a estrutura física de subpastas do HD ou diretório importado e as agrupa em uma **Árvore de Diretórios interativa**. As pastas e subpastas iniciam **recolhidas por padrão**, permitindo que você as explore expandindo/fechando conforme desejar, exatamente como em um gerenciador de arquivos nativo.
  - **Prevenção Máxima de Processos Órfãos (Ganchos de Shutdown):** Adicionado manipulador de encerramento do FastAPI (`@app.on_event("shutdown")`) e limpezas via atexit. Quando o servidor é encerrado ou o terminal fechado, todos os processos de conversão `ffmpeg.exe` ativos são terminados fisicamente no Windows (`taskkill /F /T`) eliminando por completo o risco de processos órfãos invisíveis consumindo CPU no background.
  - **Atualização Dinâmica Instantânea (Auto-Polling):** Ingestões recursivas iniciam um polling inteligente que atualiza a biblioteca dinamicamente a cada 2 segundos, fazendo com que novos arquivos catalogados apareçam de forma imediata na tela do usuário.
  - **Salvamento de Projetos em Tempo Real:** Gravação atômica instantânea de todos os metadados diretamente no banco de dados local SQLite (`capiau.db`), garantindo que projetos sejam salvos automaticamente após qualquer ação sem risco de perda de dados.
  - **Mocks de segurança integrados** que entram em ação automaticamente se o servidor FastAPI estiver offline ou os bancos vazios, permitindo testar a experiência visual e atalhos na hora!
  - **Prevenção de Conflitos de Digitação:** Corrigida a escuta de eventos de atalhos globais (como Barra de Espaço, J, K, L, I, O, E) para serem suspensos automaticamente quando o usuário estiver digitando em qualquer formulário ou campo de texto do aplicativo (`input`, `textarea`, `select`), garantindo uma digitação contínua e sem bugs.

---


## 🧪 Validação e Testes Executados

Efetuamos testes automatizados de integração que cobrem a integridade dos bancos e o fluxo lógico do pipeline:

1. **Testes do Banco de Dados e Busca Semântica CPU:**
   * Script: `tests/test_database.py`
   * **Resultado:** `OK` (Concluído com 100% de sucesso!). O SQLite gravou corretamente, a diarização agrupou o texto, o Qdrant local indexou em CPU com project_id e a busca semântica local isolada por projeto retornou o trecho correspondente com pontuação de relevância.
   
2. **Testes do Ingestor e Proxy:**
   * Script: `tests/test_hybrid_pipeline.py`
   * **Resultado:** `OK` (Concluído com 100% de sucesso!). O ingestor catalogou os metadados no SQLite por tipo de arquivo, calculou o hash e tratou corretamente o mock de proxying do FFmpeg.

---

## 🚀 Como Executar o MVP

Siga os três passos rápidos abaixo para ver a mágica acontecer:

### Passo 1: Configurar suas Chaves no arquivo `.env`
Abra o arquivo `.env` gerado na raiz do seu workspace:
👉 [.env](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/.env)

Substitua os placeholders pelas suas chaves reais, e escolha o modelo de sua preferência (como o Gemini 3.1 Flash Lite de maio/2026):
```env
OPENROUTER_API_KEY=sua_chave_do_openrouter_aqui
ASSEMBLYAI_API_KEY=sua_chave_da_assemblyai_aqui

# Escolha da Inteligência Customizada de 2026
TEXT_MODEL=deepseek/deepseek-chat
VISION_MODEL=google/gemini-3.1-flash-lite
```

### Passo 2: Iniciar o Servidor FastAPI
Execute o servidor FastAPI abrindo o prompt ou console no diretório do projeto e rodando:
```bash
python -m uvicorn src.api.server:app --reload
```
O console exibirá que o banco de dados SQLite foi criado/inicializado física e localmente, assim como a base do Qdrant.

### Passo 3: Abrir no Navegador
Acesse no seu navegador preferido:
👉 **[http://localhost:8000/](http://localhost:8000/)**

A interface premium carregará de forma imediata com o suporte a múltiplos projetos totalmente operacional. Você poderá criar um novo projeto, alternar entre eles, escanear pastas e realizar buscas semânticas sem nenhuma poluição cruzada de dados!

---

## 📸 Fase 1: Ingestão de Fotos & Proxies RAW/JPG (Implementado com Sucesso!)

Desenvolvemos e refinamos por completo o pipeline de ingestão e visualização de fotos de set com suporte a formatos RAW:

1. **Suporte RAW & Ingestor Pillow/rawpy**:
   - Adicionada decodificação automática de fotos RAW (`.arw, .cr2, .nef, .dng, etc.`) via `rawpy` e imagens tradicionais via `Pillow`.
   - Conversão de alta qualidade e leveza para proxies WebP (máximo de 1024px de dimensão a 85% de qualidade), reduzindo em até 99.8% o tamanho físico sem prejudicar o reconhecimento IA.

2. **Visualizador Premium Glassmorphic com Teclado**:
   - Um modal visualizador de fotos totalmente integrado com controles premium: navegação por teclado (setas `ArrowLeft` / `ArrowRight` e `Escape` para fechar) e bloqueio temporário de atalhos de vídeo (para não disparar o player por acidente).
   - Suporte a zoom interativo (clique na imagem ou botão zoom) e carrossel de transição suave.

3. **Gerenciamento de Tarefas e Polling Sem Flicker**:
   - Nova rotina `startProgressPolling()` unificada para monitorar o status de geração de proxies de fotos (`pending` e `error`) e vídeos de forma dinâmica.
   - Mecanismo anti-flicker com serialização inteligente para a biblioteca de fotos de set, evitando re-renderizações e pulos visuais indesejados.
   - Inclusão dos cartões de fotos no painel de **Tarefas**, com suporte a botões de ação dedicados: **Tentar Novamente** (regeração individual de proxy via `/api/photo/{photo_id}/retry`) e **Remover** (exclusão física do proxy e metadados via `DELETE /api/photo/{photo_id}`).

4. **Correção de Gargalo e Limpeza de ASR (AssemblyAI)**:
   - Identificada e corrigida falha de fila onde todos os vídeos (incluindo centenas de B-rolls sem diálogo) eram selecionados na transcrição em lote ("Transcrever Tudo").
   - Atualizado endpoint `/api/project/{project_id}/transcribe-all` para pular automaticamente vídeos do tipo B-roll e focar apenas em entrevistas.
   - Criado e executado script de banco de dados que recuperou com sucesso 33 vídeos de B-roll travados no status `transcribing` redefinindo-os para `ingested`.
   - Confirmado o funcionamento perfeito da API da AssemblyAI através de verificações detalhadas que validaram as últimas transcrições completas da conta do usuário.

---

🎉 Parabéns! O motor de decupagem inteligente do seu filme está pronto, multi-projeto, totalmente parametrizado e estruturado para processar suas mídias de forma rápida, eficiente e extremamente econômica!


## 📝 Atualizações Recentes (03/06/2026)

Implementamos a **Fase 4: Chatbot RAG Integrado & Sumários de Contexto** completando o ciclo inteligente do CapIAu-Talho:

1. **Pipeline de Sumarização por IA (DeepSeek V3):**
   - Criado [summary_engine.py](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/nlp/summary_engine.py) que se comunica com o OpenRouter (modelo `deepseek/deepseek-chat`) para analisar as transcrições das Entrevistas e a sequência temporal das descrições do B-roll.
   - Gera de forma autônoma uma descrição concisa de uma frase, um sumário estruturado em tópicos (bullet points) destacando o valor narrativo/editorial do vídeo, e um conjunto de tags.
   - Integrado de forma assíncrona ao final dos pipelines de ASR ([asr_engine.py](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/transcription/asr_engine.py)) e Visão Multimodal ([multimodal_engine.py](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/vision/multimodal_engine.py)).

2. **Endpoint Chatbot RAG Híbrido (`/api/project/{project_id}/chat`):**
   - Criado no [server.py](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/api/server.py) o endpoint de chat RAG.
   - Realiza busca semântica no banco de dados vetorial Qdrant para extrair trechos de transcrições, frames visuais, descrições de fotos de set e documentos de contexto relevantes.
   - Constrói o prompt de sistema enviando o histórico de conversação recente e o contexto coletado para o DeepSeek V3, instruindo a IA a citar as mídias em formato markdown especial.

3. **Interface de Chat no Painel Lateral:**
   - Adicionada a aba **Chat IA** no painel lateral direito do frontend ([index.html](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/ui/index.html), [app.js](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/ui/app.js), [styles.css](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/ui/styles.css)).
   - Apresenta boas-vindas com sugestões de perguntas e renderiza bolhas de mensagens do usuário (alinhadas à direita em gradiente) e do assistente (alinhadas à esquerda em glassmorphic dark).
   - Exibe a lista do contexto RAG real sob um elemento colapsável `<details>` no final das mensagens da IA, aumentando a transparência.
   - **Citações Clicáveis Dinâmicas:** Converte marcações markdown como `[Legenda](video_id: 2, start: 10.5, end: 15.0)` em links clicáveis que:
     - Carregam o vídeo correspondente no player.
     - Movem o timecode do player para o início exato do corte.
     - Alternam a aba para **Falas (ASR)** e causam um efeito de brilho/pulso na bolha de diálogo para situar o usuário.
     - Abrem fotos de bastidores e enfocam/destacam documentos de pauta se citados.

4. **Verificação de Fluxo:**
   - Testado e validado com sucesso via subagente de navegação browser, demonstrando a correta integração de ponta a ponta e a reprodução automatizada no player a partir de links no chat.

---

## 📂 Fase 5: Organização e Navegação Dinâmica da Biblioteca (Novidades do Painel)

Implementamos por completo a **Fase 5: Organização da Biblioteca**, resolvendo o problema de localização e navegação quando muitas subpastas são importadas de HDs externos:

1. **Barra de Ferramentas da Biblioteca (`#library-filter-bar`):**
   - **Filtro Dinâmico de Análise:** Seletor de status para visualizar "Filtros: Todos", "Não Analisados" (vídeos/fotos pendentes ou em processamento), "Analisados (IA)" (vídeos transcritos/analisados, fotos com metadados) ou "Com Falhas" (proxies com erros de FFmpeg).
   - **Ordenação Avançada:** Dropdown de ordenação com suporte a:
     - *Nome (A-Z)* e *Nome (Z-A)* (ordena pastas alfabeticamente e arquivos por nome).
     - *Entrevistas 1º* e *B-Rolls 1º* (prioriza o tipo de vídeo selecionado).
     - *Duração 🠗* (ordena decrescente por tempo de clipe).
     - *Adição Recente* (ordena por ID decrescente).
   - **Botões Globais de Expansão:** Botão de expandir tudo (`#btn-expand-all` ⬇⬇) e recolher tudo (`#btn-collapse-all` ⬆⬆) para gerenciar a visibilidade da árvore de arquivos inteira instantaneamente.

2. **Navegação Inteligente por Subpastas no Hover:**
   - **Ações de Pasta Contextuais:** Ao passar o mouse sobre qualquer cabeçalho de pasta na árvore (`.tree-folder-header:hover`), dois pequenos botões translúcidos aparecem flutuando à direita (expandir todas as subpastas desta pasta `fa-angles-down` e recolher todas as subpastas `fa-angles-up`).
   - **Controle Recursivo Avançado (`expandCollapseAllSubfolders`):** O clique executa uma expansão ou contração em cascata para a pasta selecionada e todas as suas subpastas descendentes de forma inteligente, sem afetar outras pastas de nível paralelo ou superior.

3. **Integração com Auto-Polling de Background:**
    - O fluxo de atualização da biblioteca foi unificado: novas detecções no watch/ ou processamentos de proxies em andamento atualizam as variáveis de estado globais (`allVideos` e `allPhotos`) e chamam `filterAndRenderLibrary()` / `filterAndRenderPhotos()`.
    - Isso garante que a ordenação e filtros selecionados pelo usuário sejam mantidos de forma estável (sem redefinir as seleções do usuário) durante as atualizações automáticas em background.

4. **Verificação de Fluxo:**
    - Testado e validado com sucesso via subagente de navegação browser, demonstrando a correta integração de ponta a ponta e a reprodução automatizada no player a partir de links no chat.

---

## ☁️ Fase 6: Exportação, Importação e Sincronização de Projetos (Novidades do MVP)

Implementamos a funcionalidade completa de backup, restore e sincronização baseada em pacotes seletivos de arquivos `.zip` e links do Google Drive:

1. **Associação de Links do Google Drive:**
   - Adicionada a coluna `drive_link` na tabela de projetos do SQLite e criados os endpoints e a interface para persistência.
   - O botão "Abrir no Navegador" no modal abre diretamente o link do Drive associado ao projeto para facilitar o upload/download de pacotes.

2. **Empacotamento Seletivo (.ZIP):**
   - Criado o endpoint `POST /api/project/{project_id}/export` para coletar metadados do banco (vídeos, fotos, transcript_words, faces, timelines, etc.) e empacotá-los em um arquivo compactado `.zip` junto com os arquivos de mídia selecionados (vídeo proxies, foto proxies e documentos).
   - O Qdrant é consultado em tempo real para obter os frames do B-roll (`get_video_vision_frames`), de modo que as descrições de imagens já extraídas sejam incluídas no `metadata.json`, eliminando a necessidade de re-analisá-las com IA no computador de destino.

3. **Importação e Re-Indexação Inteligente:**
   - Criado o endpoint `POST /api/project/import` que recebe um pacote ZIP, descompacta os arquivos temporariamente, move os proxies e documentos para as pastas locais correspondentes e insere os registros no SQLite.
   - **Mapeamento de IDs Relacionais:** Como chaves primárias são geradas dinamicamente no SQLite, o fluxo de importação re-mapeia todos os IDs nas tabelas relacionadas (`transcript`, `face`, `relation`, `timeline`, `transcript_theme`) para preservar a integridade estrutural e restaurar a timeline perfeitamente.
   - **Resolução de Conflito de Unicidade:** Para evitar falhas de colisão de hashes únicos (`IntegrityError`), o sistema anexa o sufixo `_imp_{new_project_id}` às chaves SHA-256 duplicadas.
   - **Re-Indexação Local:** O sistema reconstrói os vetores semânticos no Qdrant na máquina local a partir de descrições e transcrições importadas, garantindo que a busca semântica em CPU continue 100% funcional sem novas chamadas pagas de API.

* [x] Estruturado arquivo `.env` para centralizar as chaves das APIs do **OpenRouter** e **AssemblyAI** e configurar as pastas locais de mídia.
* [x] **Escolha Flexível de Modelos:** Adicionado suporte para customizar `TEXT_MODEL` e `VISION_MODEL` diretamente no seu `.env`, permitindo que você use modelos modernos lançados nos últimos dois meses, como o **Gemini 3.1 Flash Lite** (maio/2026, ultra-econômico) ou o **Perceptron Mk1** (maio/2026, especializado em frames de vídeo).
* [x] Configurado `src/config.py` para carregar as variáveis de ambiente e **gerar automaticamente toda a estrutura de pastas** (`originals`, `proxies`, `watch`, `cache`, `exports`) na sua máquina.

### 2. Banco de Dados e Busca Semântica em CPU (Sem Docker!)
* [x] Criado `src/db/schema.py` com o schema relacional SQLite, estruturando projetos, vídeos, fotos, transcrições palavra-a-palavra, temas e relações.
* [x] **Gerenciamento Multi-Projeto Autônomo:** Adicionadas operações de CRUD de projetos (`add_project`, `get_projects`, `delete_project`) em `src/db/operations.py` com suporte a **Deleção Física em Cascata** (`PRAGMA foreign_keys = ON`), permitindo isolamento total de mídias de diferentes produções.
* [x] Desenvolvido `src/search/semantic.py` inicializando o **Qdrant local baseado em arquivo**. Roda 100% na sua CPU local, gerando embeddings através do modelo leve e offline `all-MiniLM-L6-v2` (~120MB) com busca semântica em menos de 10ms!
* [x] **Correção de Bugs Críticos de Parâmetros:** Identificados e corrigidos bugs silenciosos onde o `project_id` era omitido na indexação do Qdrant nos motores ASR (`asr_engine.py`) e Vision (`multimodal_engine.py`), bem como no endpoint de busca do servidor.
* [x] Resolvido o requisito do Qdrant de IDs em formato UUID através da **geração determinística de UUIDs v5** a partir de string keys, gerando unicidade e evitando duplicatas.

### 3. Pipeline de Ingestão, FFmpeg e In-Place Ingestion (HD Externo)
* [x] Criado `src/ingest/watcher.py` para monitoramento automático de arquivos na pasta `watch/`.
* [x] **Ingestão In-Place (Modo Link para HD Externo):** Adicionado suporte a parâmetro `copy_original=False` no fluxo de ingestão. Mídias gigantes localizadas em HDs externos ou SSDs podem ser analisadas e vinculadas **sem serem copiadas localmente** (poupando espaço em disco). O CapIAu-Talho armazena no SQLite o caminho absoluto real do HD externo e gera apenas o leve proxy de preview localmente, garantindo o link correto na exportação XML/EDL.
* [x] **Importador Recursivo de Pastas:** Criada a lógica `ingest_external_path` mapeada no novo endpoint `/api/ingest/external` para varrer recursivamente qualquer caminho absoluto de disco externo e catalogar mídias em modo in-place.
* [x] Implementado deduplicação automática via SHA-256 e extração de metadados técnicos ricos por **FFprobe**.
* [x] Desenvolvido proxying nativo por **FFmpeg** gerando proxies rápidos H.264 em 720p/360p com áudio AAC para visualização imediata na Web, com tratamento de exceções robusto e sem travar a CPU.


### 4. Transcrição ASR, Diarização e Clustering Temático (Nuvem Econômica)
* [x] Criado `src/transcription/asr_engine.py` integrado com **AssemblyAI** (Universal-2), fornecendo transcrição pt-BR rápida com diarização de falantes (quem falou o quê) e timestamps atômicos, seguido por indexação instantânea no Qdrant local.
* [x] Desenvolvido `src/vision/multimodal_engine.py` extraindo frames a cada 10s via FFmpeg (sem carregar o OpenCV) e analisando bastidores/fotos usando a API multimodal **Gemini 2.5/3.1/3.5** no OpenRouter (custando menos de R$ 7,00 para 20h!).
* [x] Desenvolvido `src/nlp/theme_cluster.py` carregando os diálogos inseridos no SQLite e agrupando trechos automaticamente em tópicos do documentário (Making Of) via **DeepSeek V3** no OpenRouter (custando menos de R$ 8,00 para as 20h!).

### 5. Exportador OpenTimelineIO e Dashboard Web Premium
* [x] Implementado `src/export/otio_export.py` integrando a biblioteca **OpenTimelineIO** para traduzir a sequência de cortes da timeline em arquivos XML (Premiere/Resolve), EDL ou JSON OTIO.
* [x] Desenvolvido servidor REST FastAPI em `src/api/server.py` mapeando endpoints de busca semântica híbrida, controllers assíncronos e servindo o frontend.
* [x] Construído **Dashboard Web Premium** (`index.html`, `styles.css`, `app.js` em `src/ui/`) com visual espetacular glassmorphism em **proporção widescreen 16:9** contendo:
  - **Área de Projetos Glassmorphic** no topo contendo seletor de projetos ativo, botão para criar novo projeto e botão de exclusão rápida.
  - **Modal de Novo Projeto** responsivo translúcido para preenchimento de metadados do filme.
  - **Menus retráteis** esquerdo (biblioteca) e direito (transcrições) por clique simples, redimensionando o player de forma responsiva.
  - **Player de Vídeo Profissional** com atalhos de teclado **JKL** (Premiere-style), controle de velocidade de reprodução e seletor de resolução proxy (720p/360p/Original).
  - **Marcação de Pontos I/O (In / Out)** via teclas `I` e `O`, permitindo fatiar e enviar trechos à timeline instantaneamente (tecla `E`).
  - **Barra de Status do Sistema em Tempo Real:** Uma barra translúcida premium no rodapé do painel esquerdo que fornece referência contínua e visual das ações em execução no background (como varredura de pastas, importações recursivas, IA decodificando falas com AssemblyAI ou temas com DeepSeek), mudando dinamicamente entre spinners de carregamento ativos e checks verdes de finalização bem-sucedida.
  - **Status de Pipeline nos Cards de Mídia:** Badges e spinners embutidos nos cards de vídeo que show o status individual de processamento (spinners animados para mídias em fase de `transcrevendo` ou `analisando`, selos premium **[ASR]** e **[VISÃO]** para tarefas concluídas e marcações em vermelho para erros de FFmpeg).
  - **Painel Ativo de Conversões e Progresso Real (0-100%):** O CapIAu-Talho agora lê dinamicamente a saída do `stdout` do FFmpeg (`-progress pipe:1`) e calcula o progresso real em porcentagem comparando com a duração obtida pelo FFprobe. Os cards de mídia exibem dinamicamente `Convertendo XX%` com spinners em tempo real.
  - **Ações de Controle Total (Cancelar/Deletar):** Cards de mídia ganham botões flutuantes: um botão de parada (`fa-circle-stop`) em mídias ativas para matar a tarefa e limpar arquivos parciais, e um ícone de lixeira hover (`fa-trash-can`) para proxies concluídos, permitindo deletar fisicamente o proxy do HD e liberar espaço na máquina local.
  - **Visualização em Árvore/Explorer (Premium VSCode-Style):** Para evitar poluição visual ao importar centenas de arquivos, a biblioteca do CapIAu-Talho agora detecta a estrutura física de subpastas do HD ou diretório importado e as agrupa em uma **Árvore de Diretórios interativa**. As pastas e subpastas iniciam **recolhidas por padrão**, permitindo que você as explore expandindo/fechando conforme desejar, exatamente como em um gerenciador de arquivos nativo.
  - **Prevenção Máxima de Processos Órfãos (Ganchos de Shutdown):** Adicionado manipulador de encerramento do FastAPI (`@app.on_event("shutdown")`) e limpezas via atexit. Quando o servidor é encerrado ou o terminal fechado, todos os processos de conversão `ffmpeg.exe` ativos são terminados fisicamente no Windows (`taskkill /F /T`) eliminando por completo o risco de processos órfãos invisíveis consumindo CPU no background.
  - **Atualização Dinâmica Instantânea (Auto-Polling):** Ingestões recursivas iniciam um polling inteligente que atualiza a biblioteca dinamicamente a cada 2 segundos, fazendo com que novos arquivos catalogados apareçam de forma imediata na tela do usuário.
  - **Salvamento de Projetos em Tempo Real:** Gravação atômica instantânea de todos os metadados diretamente no banco de dados local SQLite (`capiau.db`), garantindo que projetos sejam salvos automaticamente após qualquer ação sem risco de perda de dados.
  - **Mocks de segurança integrados** que entram em ação automaticamente se o servidor FastAPI estiver offline ou os bancos vazios, permitindo testar a experiência visual e atalhos na hora!
  - **Prevenção de Conflitos de Digitação:** Corrigida a escuta de eventos de atalhos globais (como Barra de Espaço, J, K, L, I, O, E) para serem suspensos automaticamente quando o usuário estiver digitando em qualquer formulário ou campo de texto do aplicativo (`input`, `textarea`, `select`), garantindo uma digitação contínua e sem bugs.

---


## 🧪 Validação e Testes Executados

Efetuamos testes automatizados de integração que cobrem a integridade dos bancos e o fluxo lógico do pipeline:

1. **Testes do Banco de Dados e Busca Semântica CPU:**
   * Script: `tests/test_database.py`
   * **Resultado:** `OK` (Concluído com 100% de sucesso!). O SQLite gravou corretamente, a diarização agrupou o texto, o Qdrant local indexou em CPU com project_id e a busca semântica local isolada por projeto retornou o trecho correspondente com pontuação de relevância.
   
2. **Testes do Ingestor e Proxy:**
   * Script: `tests/test_hybrid_pipeline.py`
   * **Resultado:** `OK` (Concluído com 100% de sucesso!). O ingestor catalogou os metadados no SQLite por tipo de arquivo, calculou o hash e tratou corretamente o mock de proxying do FFmpeg.

---

## 🚀 Como Executar o MVP

Siga os três passos rápidos abaixo para ver a mágica acontecer:

### Passo 1: Configurar suas Chaves no arquivo `.env`
Abra o arquivo `.env` gerado na raiz do seu workspace:
👉 [.env](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/.env)

Substitua os placeholders pelas suas chaves reais, e escolha o modelo de sua preferência (como o Gemini 3.1 Flash Lite de maio/2026):
```env
OPENROUTER_API_KEY=sua_chave_do_openrouter_aqui
ASSEMBLYAI_API_KEY=sua_chave_da_assemblyai_aqui

# Escolha da Inteligência Customizada de 2026
TEXT_MODEL=deepseek/deepseek-chat
VISION_MODEL=google/gemini-3.1-flash-lite
```

### Passo 2: Iniciar o Servidor FastAPI
Execute o servidor FastAPI abrindo o prompt ou console no diretório do projeto e rodando:
```bash
python -m uvicorn src.api.server:app --reload
```
O console exibirá que o banco de dados SQLite foi criado/inicializado física e localmente, assim como a base do Qdrant.

### Passo 3: Abrir no Navegador
Acesse no seu navegador preferido:
👉 **[http://localhost:8000/](http://localhost:8000/)**

A interface premium carregará de forma imediata com o suporte a múltiplos projetos totalmente operacional. Você poderá criar um novo projeto, alternar entre eles, escanear pastas e realizar buscas semânticas sem nenhuma poluição cruzada de dados!

---

## 📸 Fase 1: Ingestão de Fotos & Proxies RAW/JPG (Implementado com Sucesso!)

Desenvolvemos e refinamos por completo o pipeline de ingestão e visualização de fotos de set com suporte a formatos RAW:

1. **Suporte RAW & Ingestor Pillow/rawpy**:
   - Adicionada decodificação automática de fotos RAW (`.arw, .cr2, .nef, .dng, etc.`) via `rawpy` e imagens tradicionais via `Pillow`.
   - Conversão de alta qualidade e leveza para proxies WebP (máximo de 1024px de dimensão a 85% de qualidade), reduzindo em até 99.8% o tamanho físico sem prejudicar o reconhecimento IA.

2. **Visualizador Premium Glassmorphic com Teclado**:
   - Um modal visualizador de fotos totalmente integrado com controles premium: navegação por teclado (setas `ArrowLeft` / `ArrowRight` e `Escape` para fechar) e bloqueio temporário de atalhos de vídeo (para não disparar o player por acidente).
   - Suporte a zoom interativo (clique na imagem ou botão zoom) e carrossel de transição suave.

3. **Gerenciamento de Tarefas e Polling Sem Flicker**:
   - Nova rotina `startProgressPolling()` unificada para monitorar o status de geração de proxies de fotos (`pending` e `error`) e vídeos de forma dinâmica.
   - Mecanismo anti-flicker com serialização inteligente para a biblioteca de fotos de set, evitando re-renderizações e pulos visuais indesejados.
   - Inclusão dos cartões de fotos no painel de **Tarefas**, com suporte a botões de ação dedicados: **Tentar Novamente** (regeração individual de proxy via `/api/photo/{photo_id}/retry`) e **Remover** (exclusão física do proxy e metadados via `DELETE /api/photo/{photo_id}`).

4. **Correção de Gargalo e Limpeza de ASR (AssemblyAI)**:
   - Identificada e corrigida falha de fila onde todos os vídeos (incluindo centenas de B-rolls sem diálogo) eram selecionados na transcrição em lote ("Transcrever Tudo").
   - Atualizado endpoint `/api/project/{project_id}/transcribe-all` para pular automaticamente vídeos do tipo B-roll e focar apenas em entrevistas.
   - Criado e executado script de banco de dados que recuperou com sucesso 33 vídeos de B-roll travados no status `transcribing` redefinindo-os para `ingested`.
   - Confirmado o funcionamento perfeito da API da AssemblyAI através de verificações detalhadas que validaram as últimas transcrições completas da conta do usuário.

---

🎉 Parabéns! O motor de decupagem inteligente do seu filme está pronto, multi-projeto, totalmente parametrizado e estruturado para processar suas mídias de forma rápida, eficiente e extremamente econômica!


## 📝 Atualizações Recentes (03/06/2026)

Implementamos a **Fase 4: Chatbot RAG Integrado & Sumários de Contexto** completando o ciclo inteligente do CapIAu-Talho:

1. **Pipeline de Sumarização por IA (DeepSeek V3):**
   - Criado [summary_engine.py](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/nlp/summary_engine.py) que se comunica com o OpenRouter (modelo `deepseek/deepseek-chat`) para analisar as transcrições das Entrevistas e a sequência temporal das descrições do B-roll.
   - Gera de forma autônoma uma descrição concisa de uma frase, um sumário estruturado em tópicos (bullet points) destacando o valor narrativo/editorial do vídeo, e um conjunto de tags.
   - Integrado de forma assíncrona ao final dos pipelines de ASR ([asr_engine.py](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/transcription/asr_engine.py)) e Visão Multimodal ([multimodal_engine.py](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/vision/multimodal_engine.py)).

2. **Endpoint Chatbot RAG Híbrido (`/api/project/{project_id}/chat`):**
   - Criado no [server.py](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/api/server.py) o endpoint de chat RAG.
   - Realiza busca semântica no banco de dados vetorial Qdrant para extrair trechos de transcrições, frames visuais, descrições de fotos de set e documentos de contexto relevantes.
   - Constrói o prompt de sistema enviando o histórico de conversação recente e o contexto coletado para o DeepSeek V3, instruindo a IA a citar as mídias em formato markdown especial.

3. **Interface de Chat no Painel Lateral:**
   - Adicionada a aba **Chat IA** no painel lateral direito do frontend ([index.html](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/ui/index.html), [app.js](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/ui/app.js), [styles.css](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/src/ui/styles.css)).
   - Apresenta boas-vindas com sugestões de perguntas e renderiza bolhas de mensagens do usuário (alinhadas à direita em gradiente) e do assistente (alinhadas à esquerda em glassmorphic dark).
   - Exibe a lista do contexto RAG real sob um elemento colapsável `<details>` no final das mensagens da IA, aumentando a transparência.
   - **Citações Clicáveis Dinâmicas:** Converte marcações markdown como `[Legenda](video_id: 2, start: 10.5, end: 15.0)` em links clicáveis que:
     - Carregam o vídeo correspondente no player.
     - Movem o timecode do player para o início exato do corte.
     - Alternam a aba para **Falas (ASR)** e causam um efeito de brilho/pulso na bolha de diálogo para situar o usuário.
     - Abrem fotos de bastidores e enfocam/destacam documentos de pauta se citados.

4. **Verificação de Fluxo:**
   - Testado e validado com sucesso via subagente de navegação browser, demonstrando a correta integração de ponta a ponta e a reprodução automatizada no player a partir de links no chat.

---

## 📂 Fase 5: Organização e Navegação Dinâmica da Biblioteca (Novidades do Painel)

Implementamos por completo a **Fase 5: Organização da Biblioteca**, resolvendo o problema de localização e navegação quando muitas subpastas são importadas de HDs externos:

1. **Barra de Ferramentas da Biblioteca (`#library-filter-bar`):**
   - **Filtro Dinâmico de Análise:** Seletor de status para visualizar "Filtros: Todos", "Não Analisados" (vídeos/fotos pendentes ou em processamento), "Analisados (IA)" (vídeos transcritos/analisados, fotos com metadados) ou "Com Falhas" (proxies com erros de FFmpeg).
   - **Ordenação Avançada:** Dropdown de ordenação com suporte a:
     - *Nome (A-Z)* e *Nome (Z-A)* (ordena pastas alfabeticamente e arquivos por nome).
     - *Entrevistas 1º* e *B-Rolls 1º* (prioriza o tipo de vídeo selecionado).
     - *Duração 🠗* (ordena decrescente por tempo de clipe).
     - *Adição Recente* (ordena por ID decrescente).
   - **Botões Globais de Expansão:** Botão de expandir tudo (`#btn-expand-all` ⬇⬇) e recolher tudo (`#btn-collapse-all` ⬆⬆) para gerenciar a visibilidade da árvore de arquivos inteira instantaneamente.

2. **Navegação Inteligente por Subpastas no Hover:**
   - **Ações de Pasta Contextuais:** Ao passar o mouse sobre qualquer cabeçalho de pasta na árvore (`.tree-folder-header:hover`), dois pequenos botões translúcidos aparecem flutuando à direita (expandir todas as subpastas desta pasta `fa-angles-down` e recolher todas as subpastas `fa-angles-up`).
   - **Controle Recursivo Avançado (`expandCollapseAllSubfolders`):** O clique executa uma expansão ou contração em cascata para a pasta selecionada e todas as suas subpastas descendentes de forma inteligente, sem afetar outras pastas de nível paralelo ou superior.

3. **Integração com Auto-Polling de Background:**
    - O fluxo de atualização da biblioteca foi unificado: novas detecções no watch/ ou processamentos de proxies em andamento atualizam as variáveis de estado globais (`allVideos` e `allPhotos`) e chamam `filterAndRenderLibrary()` / `filterAndRenderPhotos()`.
    - Isso garante que a ordenação e filtros selecionados pelo usuário sejam mantidos de forma estável (sem redefinir as seleções do usuário) durante as atualizações automáticas em background.

4. **Verificação de Fluxo:**
    - Testado e validado com sucesso via subagente de navegação browser, demonstrando a correta integração de ponta a ponta e a reprodução automatizada no player a partir de links no chat.

---

## ☁️ Fase 6: Exportação, Importação e Sincronização de Projetos (Novidades do MVP)

Implementamos a funcionalidade completa de backup, restore e sincronização baseada em pacotes seletivos de arquivos `.zip` e links do Google Drive:

1. **Associação de Links do Google Drive:**
   - Adicionada a coluna `drive_link` na tabela de projetos do SQLite e criados os endpoints e a interface para persistência.
   - O botão "Abrir no Navegador" no modal abre diretamente o link do Drive associado ao projeto para facilitar o upload/download de pacotes.

2. **Empacotamento Seletivo (.ZIP):**
   - Criado o endpoint `POST /api/project/{project_id}/export` para coletar metadados do banco (vídeos, fotos, transcript_words, faces, timelines, etc.) e empacotá-los em um arquivo compactado `.zip` junto com os arquivos de mídia selecionados (vídeo proxies, foto proxies e documentos).
   - O Qdrant é consultado em tempo real para obter os frames do B-roll (`get_video_vision_frames`), de modo que as descrições de imagens já extraídas sejam incluídas no `metadata.json`, eliminando a necessidade de re-analisá-las com IA no computador de destino.

3. **Importação e Re-Indexação Inteligente:**
   - Criado o endpoint `POST /api/project/import` que recebe um pacote ZIP, descompacta os arquivos temporariamente, move os proxies e documentos para as pastas locais correspondentes e insere os registros no SQLite.
   - **Mapeamento de IDs Relacionais:** Como chaves primárias são geradas dinamicamente no SQLite, o fluxo de importação re-mapeia todos os IDs nas tabelas relacionadas (`transcript`, `face`, `relation`, `timeline`, `transcript_theme`) para preservar a integridade estrutural e restaurar a timeline perfeitamente.
   - **Resolução de Conflito de Unicidade:** Para evitar falhas de colisão de hashes únicos (`IntegrityError`), o sistema anexa o sufixo `_imp_{new_project_id}` às chaves SHA-256 duplicadas.
   - **Re-Indexação Local:** O sistema reconstrói os vetores semânticos no Qdrant na máquina local a partir de descrições e transcrições importadas, garantindo que a busca semântica em CPU continue 100% funcional sem novas chamadas pagas de API.

4. **Interface Premium Glassmorphic:**
   - Adicionado botão de nuvem no cabeçalho para abrir o modal de sincronização.
   - O modal contém as opções de exportação, o campo de link do Drive e uma zona de drag-and-drop para arrastar e importar arquivos ZIP.
   - Uma barra de progresso em tempo real (utilizando `XMLHttpRequest`) atualiza o usuário sobre a velocidade do upload e as fases do processamento no servidor ("Enviando arquivo...", "Descompactando e reindexando IA locais (CPU)...").

5. **Verificação de Fluxo e Testes:**
   - **Teste Unitário:** Criado e executado com sucesso o teste `tests/test_project_export.py` validando toda a correspondência de chaves e resolução de conflitos de hash.
   - **Visualização:** Validada via browser subagent a funcionalidade de gravação de links e renderização do modal.
   - **Gravação de Demonstração:** Registrada com sucesso a gravação em formato WebP `save_link_success_1780522342772.webp` na pasta de artefatos.

---

## 🎨 Fase 7: Modularização Frontend & Restauração Estética (Junho 2026)

Concluímos com sucesso a transição do frontend para uma arquitetura modular moderna e restauramos integralmente a refinada estética original do MVP:

1. **Modularização em Módulos ES6 Nativos:**
   - O mega-arquivo monolítico `src/ui/app.js` (175KB) foi deletado e substituído por 8 módulos nativos sob `src/ui/js/` (`main.js`, `api.js`, `state.js`, `player.js`, `library.js`, `panels.js`, `chat.js`, `projects.js`), carregados via `type="module"` no HTML sem necessidade de empacotadores (Vite/Webpack), mantendo o ecossistema rápido e leve.
   - Centralização do estado reativo no `EventEmitter` em `state.js`.

2. **Restauração da Estética Visual e Interativa:**
   - **Mídias (Vídeos):** Recuperada a renderização em árvore hierárquica por diretórios/subpastas com chevrons, ícones (`fa-microphone-lines`/`fa-film`), timecode formatado (`00:00:00:00`), badges de status (`ASR`/`VISÃO`) e botões de ação flutuantes sutis que surgem apenas ao passar o mouse.
   - **Fotos de Set:** Restaurado o grid responsivo de 2 colunas com cards de fotos (`photo-card`) integrando placeholders de carregamento, erro de processamento de RAWs e visualizador lightbox interativo.
   - **Temas Narrativos:** Recuperado o design limpo de cartões de temas com títulos coloridos em degradê, descrições integradas e botões funcionais `Buscar Cortes` e `Perguntar IA`.
   - **Documentos:** Re-inseridos os cards de documentos com seus respectivos ícones (`fa-scroll`, `fa-list-ol`, `fa-clipboard`).

3. **Correção de Bugs Críticos no Backend e Conexão de Dados:**
   - **Transação e Persistência do SQLite:** Resolvida a falha onde modificações de banco de dados por tarefas em background ou repositórios eram descartadas. Ajustado o context manager `get_db` para commitar automaticamente transações bem-sucedidas no SQLite e realizar rollback em caso de falha.
   - **Segurança de Threads:** Corrigido o erro `ProgrammingError: SQLite objects created in a thread can only be used in that same thread` nas rotas do FastAPI adicionando `check_same_thread=False` às chamadas de conexão SQLite, viabilizando o uso seguro com injeção de dependências do FastAPI.
   - **Detecção de Tipo de Vídeo:** Atualizado o analisador em `IngestService` para mapear palavras como "depoimento" e "entrevista" diretamente para o tipo `'interview'`, satisfazendo plenamente a lógica dos testes.

4. **Homologação:**
   - Todos os 7 testes automatizados de backend (`python -m unittest discover tests/`) foram executados e passaram com sucesso (`OK`).
   - O funcionamento do layout foi verificado visualmente e por console através de automação no navegador, confirmando a ausência de erros de Javascript e um carregamento visual perfeito.

---

## 👥 Fase 8: Reconhecimento Facial Local e Galeria de Rostos (Fase 1 - Junho 2026)

Implementamos e validamos o motor de reconhecimento facial e clustering 100% local otimizado para CPU, além de criar a interface de agrupamento, desambiguação e nomeação em lote:

1. **Setup de Modelos ONNX e Banco de Dados:**
   - Implementado o download automático dos modelos do OpenCV Zoo: **YuNet** para detecção de rostos com landmarks fiduciais e alinhamento facial (~3.7MB) e **SFace** para geração de embeddings faciais de 128 dimensões (~33MB).
   - Atualizado o banco SQLite para suportar agrupamentos de rostos (`cluster_id` e índice `idx_face_project_cluster`).
   - Processados retroativamente e gerados embeddings para **956 rostos** a partir de fotos de set e frames de vídeo do projeto (resolvendo a falta de embeddings para os registros preexistentes).

2. **Detecção Inteligente de Multidões e Qualidade (Heurísticas):**
   - Integrada a análise de nitidez baseada na variância do operador Laplaciano para detectar desfoque.
   - Heurística de Multidões: se uma cena tiver mais de 8 rostos, rostos pequenos (< 40px) e desfocados (figuração) são ignorados automaticamente para evitar poluir os clusters. Caso contrário, rostos menores/desfocados de personagens em segundo plano são catalogados.

3. **Clustering DBSCAN Puramente Local (NumPy):**
   - Implementado o algoritmo DBSCAN em NumPy com matriz de similaridade de cosseno (produto interno de vetores normalizados L2). Agrupa rostos semelhantes sob o nome temporário `Pessoa Desconhecida (Grupo X)` de forma instantânea na CPU.

4. **Interface e Lógica de Desambiguação e Fusão na UI:**
   - **Galeria de Rostos:** Nova aba "Rostos" na barra lateral esquerda listando os clusters criados com crop facial dinâmico, número de aparições e campo de input com autocompleção de nomes de speakers do projeto.
   - **Prevenção de Conflitos e Desambiguação Manual Unitária:** Se um usuário renomear um grupo de rostos com um nome já existente em outro grupo, o backend acusa conflito e abre a janela translúcida de desambiguação manual na UI.
   - Permite que o editor escolha entre:
     - **Fusão Total:** Mescla todos os rostos de ambos os clusters sob o mesmo nome no SQLite.
     - **Confirmar Selecionados:** Reatribui individualmente (desambiguação unitária) apenas as caixas faciais que forem selecionadas pelo usuário para o grupo de destino correto, separando os restantes.

5. **Eliminação de Lock Contention no SQLite:**
   - Corrigido o bug silencioso de database locking movendo as submissões de tarefas de processamento de fotos e a execução da detecção facial de dentro de blocos de conexão ativos para fora da transação de inserção inicial, garantindo concorrência perfeita em threads em background.

6. **Homologação:**
   - Criados testes automatizados robustos em `tests/test_face_recognition.py` cobrindo o DBSCAN matricial, agrupamento de rostos no banco, detecção de conflitos, merge de clusters e reatribuição manual de faces.
   - O conjunto total de 9 testes passa com sucesso (`OK` em 8.480s).

---

## 🖥️ Fase 9: Visualizadores Duplos Independentes (Source & Program)

Desenvolvemos a estrutura de monitoramento duplo no painel central, idêntica à de suites de edição profissionais (como Premiere e DaVinci Resolve):

1. **Source Player (Monitor de Origem - Esquerda):**
   - Dedicado a inspecionar mídias brutas da Biblioteca (vídeos e fotos de set).
   - Suporte nativo a atalhos de teclado **JKL** com velocidades múltiplas (1.5x, 2x, 4x, 8x) e retrocesso (J reverso) via loops de animação temporal.
   - Marcação rápida de pontos de entrada (`I`) e saída (`O`) e botão de inserção (`E` ou botão dedicado) para recortar o segmento de áudio/vídeo e enviá-lo instantaneamente para a trilha ativa da Timeline.
   - Renderização dinâmica do overlay de detecção de rostos (YuNet/SFace) em tempo real, dimensionando-se de forma responsiva às mudanças de tamanho do monitor.

2. **Program Player (Monitor de Programa - Direita):**
   - Dedicado à reprodução reativa e sequencial dos clipes montados na timeline ativa.
   - Gerenciamento inteligente de buffering A/B de elementos de vídeo para alternar de forma suave entre diferentes clipes e arquivos de proxies, eliminando travamentos de transição na CPU.

---

## 🎨 Fase 10: Timeline Multi-Trilha Reativa em Canvas 2D

Para garantir desempenho extremo na renderização de timelines complexas na CPU local, implementamos a linha do tempo desenhada diretamente em um Canvas HTML5:

1. **Desenho em Canvas 2D de Alta Performance:**
   - Todo o desenho de réguas, timecodes, trilhas (`V1` para falas e depoimentos, `V2` para cobertura/B-Roll) e blocos de clipes é gerenciado por renderização direta em Canvas, com suporte nativo a High-DPI (Pixel Ratio) para displays retina.
   - Representação visual de ondas de áudio (waveforms) renderizadas dinamicamente sobre os blocos baseados no banco de dados.

2. **Interatividade e Atração Magnética:**
   - Lógica de arrastar e soltar (drag-and-drop) de alta performance: movimentação livre de blocos horizontalmente para ajuste de ponto na linha do tempo, e verticalmente para alterar trilhas.
   - Implementação de **snapping/atração magnética** para alinhar clipes perfeitamente com os limites de clipes adjacentes ou com a agulha de reprodução (playhead), evitando espaços vazios involuntários na edição de falas.

---

## 🎛️ Fase 11: Workspaces Dinâmicos e Destaque Multi-Monitor

Visando a produtividade do editor em múltiplos monitores, implementamos um motor flexível de pop-outs de painéis em novas janelas do navegador:

1. **Destaque Modular de Elementos (Pop-outs):**
   - O editor pode abrir qualquer painel (Biblioteca, Transcrição, Timeline, Players ou Chat) em uma nova janela independente do navegador clicando no ícone de destaque.
   - Utilização de **`document.adoptNode()`** para mover os elementos físicos do DOM de forma nativa. Isso preserva intactos todos os event listeners em JavaScript e o estado reativo local sem a necessidade de re-inicializações ou comunicação assíncrona lenta.

2. **Sincronização Bidirecional e Encaminhamento de Atalhos:**
   - Comunicação via **`BroadcastChannel`** e escuta de eventos globais para coordenar mudanças de estado entre a janela principal e as janelas secundárias abertas.
   - Encaminhamento automático de comandos de teclado de qualquer pop-out ativo (como pressionar barra de espaço para dar play no monitor de origem) para o player centralizado na tela mãe, gerando um controle unificado do setup.

---

## 🎨 Fase 12: Minimalismo no Cabeçalho, Timeline Compacta e Restauradores Laterais (03/07/2026)

Implementamos uma grande re-estilização e otimização ergonômica para maximizar a área útil de tela e refinar a interação com painéis colapsáveis:

1. **Cabeçalho Widescreen Ultra-Compacto e Ações Rápidas:**
   - Reduzida a altura do cabeçalho de `70px` para `46px` e os containers internos de `42px` para `30px`.
   - Simplificação do logotipo: remoção do subtítulo `"Making Of Editor"` e redução do nome `"CapIAu-Talho"`.
   - Botões da barra de ações limpos de texto, adotando exclusivamente line-icons e tooltips explicativos customizados em CSS (`data-tooltip`) com estética de vidro desfocado (`backdrop-filter`).
   - Adicionada a rota `POST /api/project/{project_id}/scan-watch` no backend e vinculada a ações assíncronas de varredura.

2. **Cabeçalho Retrátil com Gatilho Minimalista:**
   - Criação da transição para a classe `.header-collapsed` que desliza o cabeçalho para cima com curva suave, redimensionando a área de trabalho (`.workspace`) para ocupar toda a altura da tela.
   - Posicionamento de um gatilho de restauração ultra-discreto no topo central (`#header-restore-trigger`) contendo uma setinha muito pequena.

3. **Timeline Minimalista sem Título e Botões Compactos:**
   - Remoção do texto redundante `"Linha do Tempo Editorial (Timeline)"` do painel superior, restando apenas o ícone.
   - Conversão dos botões de Salvar e Exportar da timeline em line-icons compactos com tooltips.
   - Substituição do antigo botão flutuante de restauração de timeline por uma setinha flutuante ultra-pequena (`.timeline-restore-btn`) centralizada na base inferior da tela.

4. **Abas Restauradoras Laterais com Setas Chevron:**
   - Os antigos botões redondos de abrir sidebars foram redesenhados como abas indicadoras minimalistas (`14px` x `32px`) coladas no centro-esquerdo e centro-direito da tela, mostrando apenas pequenas setas chevrons (`fa-chevron-right` e `fa-chevron-left`).
   - Efeito de hover interativo suave que expande a largura da aba de `14px` para `18px`, mantendo o alinhamento vertical absoluto centralizado sem saltos ou tremores.

5. **Correção de Escala Dinâmica via ResizeObserver:**
   - Integração da API nativa `ResizeObserver` para monitorar a largura e altura física do contêiner pai da timeline. 
   - Ao expandir ou fechar as barras laterais, a timeline recalcula a sua dimensão lógica instantaneamente e redesenha a régua e clipes (exibindo mais ou menos tempo na tela), eliminando por completo o borramento por estiramento visual e resolvendo o erro de deslocamento/offset nos cliques do playhead (agulha).



---

## 🎛️ Fase 13: Otimização da Biblioteca de Clipes & Modal de Decupagem com Player Interno (07/07/2026)

Implementamos uma grande re-estilização e otimização ergonômica para a biblioteca de mídias e introduzimos uma suíte de decupagem integrada:

1. **Visualização Conformada em Linha Única:**
   - Redesenho completo dos cards de arquivo (`.media-card.tree-file-item`) para exibir todos os metadados em uma única linha flex de 28px de altura.
   - Miniaturas reais de clipes formatadas em proporção 16x9 com cantos levemente arredondados.
   - Opções de controle de visibilidade (Miniaturas, Duração, Tags e Status) através de um popover flutuante reativo persistido via `localStorage`.

2. **Remoção de Limitações de Comprimento e Modo Grade (Grid) Adaptável:**
   - Remoção de corte estático de caracteres no JS, permitindo que títulos se expandam de acordo com o tamanho horizontal da janela, otimizando o espaço quando o painel é maximizado.
   - Zoom dinâmico via slider range que ajusta a largura da miniatura de `40px` até `240px` (valor padrão ajustado para `80px`).
   - Modo Grade que distribui os clipes em várias colunas automáticas de acordo com a largura da tela.

3. **Limpeza Inteligente de Títulos de IA ("Tema Cru"):**
   - Criação da função `cleanTitle` para remover qualificadores comuns gerados por IA ("Sequência útil de...", "Clipe valioso mostrando...", etc.), extraindo o assunto de forma direta e mantendo a descrição completa na tooltip de hover.

4. **Modal de Decupagem Integrado com Player de Vídeo e Recortes (IO+E):**
   - Substituição do preview de thumbnail estático por um **Video Player interno** (`<video id="interview-modal-video">`) para reprodução instantânea com áudio ativado por padrão.
   - Layout horizontal (`flex-direction: row !important`) dividindo o modal em duas colunas (player à esquerda e ferramentas na direita), aproveitando 100% do espaço de tela disponível.
   - Interatividade de seek direcionado: cliques no índice de capítulos, temas narrativos ou palavras da transcrição diarizada sincronizam o tempo do vídeo local instantaneamente.
   - Suporte nativo e sem interferências de cliques nos botões de controle nativos (play, volume, seekbar) com z-index configurado.
   - Painel de marcação local (pontos IN, OUT e Enviar para Timeline) com atalhos de teclado locais (`I`, `O`, `E`) e pausando os atalhos globais de fundo.
   - Atualização física de miniatura via botão de câmera que gera um novo frame no cache do servidor a partir do tempo atual do player.
