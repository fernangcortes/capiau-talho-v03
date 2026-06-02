# Lista de Tarefas (CapIAu MVP - Making Of & Documentário)

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

