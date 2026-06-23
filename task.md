# Lista de Tarefas (CapIAu-Talho MVP - Making Of & Documentário)

- [x] **Task 1: Setup do Ambiente Híbrido e Infraestrutura**
  - [x] Criar estrutura de pastas do projeto no workspace
  - [x] Criar arquivo `requirements.txt` com as dependências
  - [x] Criar arquivo `.env` para centralizar as chaves do OpenRouter e AssemblyAI
  - [x] Escrever script de teste de conexão das APIs em `scratch/test_connections.py`

- [x] **Task 2: Banco de Dados Híbrido SQLite + Qdrant CPU**
  - [x] Implementar `src/db/schema.py` com o schema relacional SQLite
  - [x] Criar utilitários para criar banco de dados inicial e tabelas
  - [x] Implementar `src/search/semantic.py` usando Qdrant local file-based (sem Docker)
  - [x] Testar indexação e recuperação de embeddings locais via CPU

- [x] **Task 3: Ingestão de Mídia e Geração de Proxies**
  - [x] Criar `src/ingest/watcher.py` para monitorar a pasta `watch/`
  - [x] Implementar deduplicação via hash SHA-256 e cópia para `data/originals/`
  - [x] Adicionar FFprobe para extração de metadados técnicos no SQLite
  - [x] Implementar proxying via FFmpeg (720p/360p CRF 23 AAC) para `data/proxies/`

- [x] **Task 4: Transcrição (ASR) e Diarização**
  - [x] Implementar `src/transcription/asr_engine.py` integrado com AssemblyAI
  - [x] Mapear falas palavra-a-palavra, tempos (In/Out) e speaker_id no SQLite
  - [x] Criar normalizador de falas contínuas por bloco de depoimento

- [x] **Task 5: Análise Multimodal (Visão) e Clustering Temático**
  - [x] Implementar extrator de frames dos B-rolls a cada 10s em `src/vision/multimodal_engine.py`
  - [x] Chamar Vision API (Gemini 2.5 Flash/GPT-4o-mini via OpenRouter) para descrições visuais e tags
  - [x] Implementar clustering de temas das falas via DeepSeek V3 em `src/nlp/theme_cluster.py`

- [x] **Task 6: Exportador OTIO/XML e Dashboard Web Premium**
  - [x] Criar `src/export/otio_export.py` convertendo cortes de timeline em XML/OTIO
  - [x] Desenvolver backend FastAPI em `src/api/server.py` gerenciando o pipeline
  - [x] Criar frontend `src/ui/index.html` com layout responsivo retrátil 16:9
  - [x] Criar estilos translúcidos premium `src/ui/styles.css`
  - [x] Criar lógica `src/ui/app.js` (atalhos JKL, marcadores I/O, player sincronizado, busca semântica)

- [x] **Task 7: Gerenciamento Multi-Projeto Autônomo e Correção de Bugs**
  - [x] Implementar operações CRUD de projetos em `src/db/operations.py`
  - [x] Adicionar suporte a `TEXT_MODEL` e `VISION_MODEL` em `src/config.py` e `.env`
  - [x] Integrar isolamento e filtros por `project_id` nos endpoints de `src/api/server.py`
  - [x] Corrigir bugs de assinaturas e passagem de `project_id` em `multimodal_engine.py` e `asr_engine.py`
  - [x] Resolver bug posicional da busca semântica em `/api/search`
  - [x] Modificar `src/ui/index.html` para incluir seletor de projetos glassmorphic e modal de criação
  - [x] Adicionar lógica de carregamento dinâmico e modal de projetos em `src/ui/app.js`
  - [x] Testar e verificar isolamento completo de projetos

- [x] **Task 8: Ingestão de Pastas Externas (HDs), Status em Tempo Real e Feedback Visual**
  - [x] Implementar a lógica recursiva in-place `/api/ingest/external` via `os.walk`
  - [x] Adicionar o painel de barra de status do sistema no frontend `#system-status-bar`
  - [x] Desenvolver a lógica `updateSystemStatus` conectada aos gatilhos assíncronos no Javascript
  - [x] Atualizar a renderização de cards de mídias (`renderVideos`) com spinners de carregamento e badges de status para transcrições/análises
  - [x] Desenvolver funcionalidade de transcrição em lote ("Transcrever Tudo") no backend e frontend
  - [x] Desenvolver o gerenciador ativo de subprocessos FFmpeg (`ACTIVE_CONVERSIONS`), permitindo ler o progresso real em porcentagem no frontend, pausar/cancelar conversões em andamento e deletar proxies gerados do HD físico.
  - [x] Solucionar processos órfãos de FFmpeg sobrevivendo no Windows usando ganchos de shutdown do FastAPI (`@app.on_event("shutdown")`) e taskkill.
  - [x] Implementar atualização visual dinâmica instantânea (polling de mídias e progresso) na importação de pastas externas e varreduras watch/.
  - [x] Implementar componente de exibição em Árvore de Diretórios / Explorer de arquivos (`buildTree`, `getCommonBasePath`, `renderTreeNode`), agrupando centenas de mídias de forma hierárquica por subpastas e mantendo-as recolhidas por padrão para evitar poluição visual na biblioteca.
  - [x] Rodar suite de testes e validar a estabilidade geral da aplicação

- [x] **Fase 1: Ingestão de Fotos & Proxies RAW/JPG**
# Lista de Tarefas (CapIAu-Talho MVP - Making Of & Documentário)

- [x] **Task 1: Setup do Ambiente Híbrido e Infraestrutura**
  - [x] Criar estrutura de pastas do projeto no workspace
  - [x] Criar arquivo `requirements.txt` com as dependências
  - [x] Criar arquivo `.env` para centralizar as chaves do OpenRouter e AssemblyAI
  - [x] Escrever script de teste de conexão das APIs em `scratch/test_connections.py`

- [x] **Task 2: Banco de Dados Híbrido SQLite + Qdrant CPU**
  - [x] Implementar `src/db/schema.py` com o schema relacional SQLite
  - [x] Criar utilitários para criar banco de dados inicial e tabelas
  - [x] Implementar `src/search/semantic.py` usando Qdrant local file-based (sem Docker)
  - [x] Testar indexação e recuperação de embeddings locais via CPU

- [x] **Task 3: Ingestão de Mídia e Geração de Proxies**
  - [x] Criar `src/ingest/watcher.py` para monitorar a pasta `watch/`
  - [x] Implementar deduplicação via hash SHA-256 e cópia para `data/originals/`
  - [x] Adicionar FFprobe para extração de metadados técnicos no SQLite
  - [x] Implementar proxying via FFmpeg (720p/360p CRF 23 AAC) para `data/proxies/`

- [x] **Task 4: Transcrição (ASR) e Diarização**
  - [x] Implementar `src/transcription/asr_engine.py` integrado com AssemblyAI
  - [x] Mapear falas palavra-a-palavra, tempos (In/Out) e speaker_id no SQLite
  - [x] Criar normalizador de falas contínuas por bloco de depoimento

- [x] **Task 5: Análise Multimodal (Visão) e Clustering Temático**
  - [x] Implementar extrator de frames dos B-rolls a cada 10s em `src/vision/multimodal_engine.py`
  - [x] Chamar Vision API (Gemini 2.5 Flash/GPT-4o-mini via OpenRouter) para descrições visuais e tags
  - [x] Implementar clustering de temas das falas via DeepSeek V3 em `src/nlp/theme_cluster.py`

- [x] **Task 6: Exportador OTIO/XML e Dashboard Web Premium**
  - [x] Criar `src/export/otio_export.py` convertendo cortes de timeline em XML/OTIO
  - [x] Desenvolver backend FastAPI em `src/api/server.py` gerenciando o pipeline
  - [x] Criar frontend `src/ui/index.html` com layout responsivo retrátil 16:9
  - [x] Criar estilos translúcidos premium `src/ui/styles.css`
  - [x] Criar lógica `src/ui/app.js` (atalhos JKL, marcadores I/O, player sincronizado, busca semântica)

- [x] **Task 7: Gerenciamento Multi-Projeto Autônomo e Correção de Bugs**
  - [x] Implementar operações CRUD de projetos em `src/db/operations.py`
  - [x] Adicionar suporte a `TEXT_MODEL` e `VISION_MODEL` em `src/config.py` e `.env`
  - [x] Integrar isolamento e filtros por `project_id` nos endpoints de `src/api/server.py`
  - [x] Corrigir bugs de assinaturas e passagem de `project_id` em `multimodal_engine.py` e `asr_engine.py`
  - [x] Resolver bug posicional da busca semântica em `/api/search`
  - [x] Modificar `src/ui/index.html` para incluir seletor de projetos glassmorphic e modal de criação
  - [x] Adicionar lógica de carregamento dinâmico e modal de projetos em `src/ui/app.js`
  - [x] Testar e verificar isolamento completo de projetos

- [x] **Task 8: Ingestão de Pastas Externas (HDs), Status em Tempo Real e Feedback Visual**
  - [x] Implementar a lógica recursiva in-place `/api/ingest/external` via `os.walk`
  - [x] Adicionar o painel de barra de status do sistema no frontend `#system-status-bar`
  - [x] Desenvolver a lógica `updateSystemStatus` conectada aos gatilhos assíncronos no Javascript
  - [x] Atualizar a renderização de cards de mídias (`renderVideos`) com spinners de carregamento e badges de status para transcrições/análises
  - [x] Desenvolver funcionalidade de transcrição em lote ("Transcrever Tudo") no backend e frontend
  - [x] Desenvolver o gerenciador ativo de subprocessos FFmpeg (`ACTIVE_CONVERSIONS`), permitindo ler o progresso real em porcentagem no frontend, pausar/cancelar conversões em andamento e deletar proxies gerados do HD físico.
  - [x] Solucionar processos órfãos de FFmpeg sobrevivendo no Windows usando ganchos de shutdown do FastAPI (`@app.on_event("shutdown")`) e taskkill.
  - [x] Implementar atualização visual dinâmica instantânea (polling de mídias e progresso) na importação de pastas externas e varreduras watch/.
  - [x] Implementar componente de exibição em Árvore de Diretórios / Explorer de arquivos (`buildTree`, `getCommonBasePath`, `renderTreeNode`), agrupando centenas de mídias de forma hierárquica por subpastas e mantendo-as recolhidas por padrão para evitar poluição visual na biblioteca.
  - [x] Rodar suite de testes e validar a estabilidade geral da aplicação

- [x] **Fase 1: Ingestão de Fotos & Proxies RAW/JPG**
  - [x] Suportar formatos de fotos RAW (.arw, .cr2, .nef, .dng, etc.) no ingestor (`src/ingest/watcher.py`).
  - [x] Implementar geração de proxies de fotos WebP (1024px) via Pillow/rawpy.
  - [x] Exibir proxies na biblioteca de fotos e no modal visualizador premium.
  - [x] Desenvolver carrossel, navegação por teclado (ArrowLeft, ArrowRight, Escape), controles de zoom no visualizador.
  - [x] Corrigir polling de progresso de fotos em background (`startProgressPolling`), prevenindo desligamento precoce e integrando com o feed de tarefas.
  - [x] Implementar ações de retentar conversão falha de foto individual (`/api/photo/{photo_id}/retry`) e deleção de foto (`DELETE /api/photo/{photo_id}`).
  - [x] Otimizar a rota "Transcrever Tudo" (`/api/project/{project_id}/transcribe-all`) para pular B-rolls e focar apenas em entrevistas.
  - [x] Redefinir status de vídeos B-roll stuck em 'transcribing' para 'ingested' no SQLite.
  - [x] Corrigir flickering e reset de scroll na aba de Tarefas (`renderRightPanelFeed`) reposicionando a delegação do tab check.
  - [x] Implementar a opção "Agrupar" (Grouped View) na aba de Tarefas, resumindo quantidade de arquivos por estágio de processamento (conversão, ASR, Visão, Fotos, falhas).

- [x] **Fase 1 Expansão: Schema DB, Documentos de Contexto e Visão VLM**
  - [x] Atualizar o SQLite schema em `schema.py` com as novas tabelas (`production_doc`, `face`) e colunas de vídeo (`description`, `summary`, `tags`).
  - [x] Implementar migrações dinâmicas seguras no startup (`init_db`) para adicionar novas colunas sem perda de dados.
  - [x] Implementar operações de banco para documentos e atualização de metadados em `operations.py`.
  - [x] Desenvolver parser de documentos Fountain, FDX, TXT e PDF no backend em `server.py` e indexação vetorial no Qdrant em `semantic.py`.
  - [x] Criar endpoints `/api/docs` (GET/POST/DELETE) em `server.py`.
  - [x] Criar interface lateral da aba **Documentos** (index.html) e upload/visualização de documentos (app.js).
  - [x] Inserir botões **"Analisar com IA"** individuais no player de B-roll e modal de fotos.
  - [x] Implementar endpoint de análise visual em lote (`/api/project/{project_id}/analyze-all-vision`) no backend.
  - [x] Corrigir polling de agrupamento de temas no frontend, associando-o ao monitoramento do status de tarefas ativas e recarregando via `loadThemes()`.

- [x] **Fase 2 Expansão: Edição por Texto, Busca com Foco Contextual, Splits e Overlaps**
  - [x] Renderizar palavras da transcrição como spans clicáveis e com marcação temporal na UI.
  - [x] Implementar seleção de spans de texto, atalho `Shift+E` para corte na timeline `V1`.
  - [x] Adicionar link "Ver no Contexto" na busca que foca, muda de aba e brilha a palavra-chave.
  - [x] Implementar botão de tesoura (Split) no frontend e endpoint correspondente no backend para dividir blocos de falas no banco de dados.
  - [x] Desenvolver lógica de layout para falas sobrepostas (side-by-side columns para overlaps temporais).

- [x] **Fase 3: Identificação de Rostos (Face Recognition) no CPU**
  - [x] Criar `src/vision/face_engine.py` para detecção local de rostos via Haar Cascades em fotos e frames de vídeo.
  - [x] Integrar a detecção de rostos em background ao gerar proxies de fotos.
  - [x] Integrar a detecção de rostos em background ao analisar frames de B-roll.
  - [x] Criar endpoints no backend para listar rostos e rotular nomes (`/api/face/{id}/label`).
  - [x] Criar overlay de caixas de rostos no frontend e seletor/input para rotulação.
  - [x] Desenvolver cruzamento inteligente na busca para priorizar correspondências de falantes e rostos rotulados no SQLite.

- [x] **Fase 4: Chatbot RAG Integrado & Sumários de Contexto**
  - [x] Auto-gerar sumários de vídeos e fotos na conclusão de ASR/Visão.
  - [x] Criar endpoint `/api/chat` RAG para busca híbrida combinada e resposta inteligente.
  - [x] Desenvolver interface lateral de chat e reprodução automática a partir de citações do Chatbot.

- [x] **Fase 5: Organização e Navegação Dinâmica da Biblioteca**
  - [x] Implementar filtros por status de análise ("Não Analisados", "Analisados (IA)", "Com Falhas") no frontend.
  - [x] Adicionar opções de ordenação na biblioteca (por nome, tipo de mídia, duração ou adição recente).
  - [x] Desenvolver controle recursivo de expansão/recolhimento das subpastas por nó (`expandCollapseAllSubfolders`) com botões dedicados de ação no hover.
  - [x] Criar botões globais na barra de ferramentas da biblioteca (`globalExpandCollapseAll`) para expandir/recolher todas as subpastas simultaneamente.
  - [x] Integrar a ordenação e filtros no fluxo de renderização com suporte a fotos e polling dinâmico de conversões.
