# 🎬 CapIAu-Talho v03 — Plano de Refatoração Modular

> **Data:** 2026-06-18  
> **Repositório:** https://github.com/fernangcortes/capiau-talho-v03  
> **Objetivo:** Transformar o MVP monolítico em uma arquitetura limpa (Clean Architecture) com separação de concerns, sem perder funcionalidade.

---

## 🔍 ANÁLISE PROFUNDA — O QUE ESTÁ GRANDE DEMAIS OU BAGUNÇADO

### 1. `src/api/server.py` — GOD FILE (Crítico)
**~700+ linhas, TODOS os endpoints em um único arquivo.**

- **Problema:** Mistura 12 domínios diferentes: projetos, vídeos, fotos, ingestão, transcrição, visão, busca, timeline, export, chatbot, documentos, retry/cancelamento.
- **Problema:** Lógica de negócio pesada (export ZIP, import ZIP com reconstrução de IDs, busca híbrida SQL+Qdrant+merge) está **inline** nos handlers HTTP.
- **Problema:** Background tasks com closures enormes (ex: `retry_single_video_task` definida dentro do endpoint, ~50 linhas).
- **Problema:** Importações tardias (`from src.db.operations import ...`) dentro de funções — *code smell* de dependência circular.
- **Impacto:** Impossível testar isoladamente. Alterar um endpoint de export quebra o endpoint de chat. Difícil de ler.

### 2. `src/db/operations.py` — FAT MODEL (Crítico)
**~400+ linhas, TODAS as operações CRUD de TODAS as tabelas.**

- **Problema:** Sem separação por domínio. Vídeo, foto, documento, tema, relação, transcrição, timeline, projeto, rosto — tudo junto.
- **Problema:** Padrão `get_connection()` + `try/finally: conn.close()` **repetido 30+ vezes** — violação DRY.
- **Problema:** `import_project_all_data()` é uma função monstruosa de ~150 linhas com 11 passos numerados, mapeando IDs manualmente.
- **Problema:** Não há abstração de Repository. As funções são procedurais puras.
- **Impacto:** Qualquer alteração no schema exige editar este arquivo gigante. Risco alto de regressão.

### 3. `src/ui/app.js` — MEGA-ARQUIVO FRONTEND (Crítico)
**~1500+ linhas (estimado), TODA a lógica da UI em um arquivo.**

- **Problema:** Player, timeline, busca, chat, ingestão, projetos, fotos, transcrição, visão, tasks, modal de foto, zoom, JKL controls, mock data — **tudo junto**.
- **Problema:** Estado global espalhado em dezenas de variáveis globais (`let activeVideo`, `let activeTranscript`, `let markerIn`, etc.).
- **Problema:** Mock data (`MOCK_VIDEOS`, `MOCK_TRANSCRIPT_1`, etc.) inline no topo do arquivo.
- **Problema:** Funções enormes: `renderTasksTab()` (~150 linhas), `renderSearchResults()` com HTML strings inline.
- **Problema:** Sem módulos ES6, sem classes, sem separação de concerns. Sem serviço de API centralizado.
- **Impacto:** Impossível de manter. Adicionar uma nova aba exige tocar neste arquivo monolítico.

### 4. `src/ingest/watcher.py` — MÚLTIPLAS RESPONSABILIDADES (Alto)
**~300+ linhas com 5 responsabilidades distintas.**

- **Problema:** Ingestão de arquivo, scan de pasta, geração de proxy de vídeo, geração de proxy de foto, cálculo de hash, metadados FFprobe, controle de subprocessos ativos.
- **Problema:** Variáveis globais: `ACTIVE_CONVERSIONS`, `CONVERSION_PROGRESS`, `PROXY_EXECUTOR`.
- **Problema:** `ingest_file()` mistura lógica de vídeo, áudio e foto em uma única função com `if/elif`.
- **Problema:** `retry_single_video_task` e `retry_single_photo_task` estão **duplicadas** também em `server.py`.
- **Impacto:** Difícil testar a geração de proxy sem importar toda a lógica de ingestão.

### 5. `src/transcription/asr_engine.py` — PIPELINE MONOLÍTICO (Alto)
**~300+ linhas, função `transcribe_video_api()` faz tudo.**

- **Problema:** VAD (Voice Activity Detection) com scipy/numpy, extração de áudio FFmpeg, chamada AssemblyAI, parsing de resultado, indexação Qdrant, geração de resumo por IA — **tudo em uma função**.
- **Problema:** VAD deveria ser um módulo separado de `audio_processing/`.
- **Impacto:** Não é possível testar a transcrição sem rodar VAD e indexação juntos.

### 6. `src/vision/multimodal_engine.py` — PIPELINE MONOLÍTICO (Alto)
**~200+ linhas, mistura extração de frames, API e persistência.**

- **Problema:** `extract_frame_ffmpeg()`, `encode_image_base64()`, `call_openrouter_vision()`, `analyze_broll_video()`, `analyze_set_photo()` — tudo no mesmo arquivo.
- **Problema:** `analyze_broll_video()` orquestra: extração de frames, detecção facial, chamada API, registro de relações no grafo, indexação Qdrant, geração de resumo.
- **Impacto:** Acoplamento forte. Trocar o modelo de visão exige editar este arquivo.

### 7. `src/nlp/theme_cluster.py` e `summary_engine.py` — ACOPLEAMENTO (Médio)
**Lógica de prompt, chamada API, parsing JSON e persistência no banco — tudo junto.**

- **Problema:** Parser de JSON markdown (`\`\`\`json`) **duplicado** em `theme_cluster.py`, `multimodal_engine.py`, `summary_engine.py`.
- **Problema:** Prompts hardcoded como strings multilinha dentro das funções.
- **Impacto:** Difícil versionar prompts. Parser duplicado = bugs duplicados.

### 8. Acoplamento Circular Generalizado (Crítico)
- `server.py` → `watcher`, `asr_engine`, `multimodal_engine`, `theme_cluster`, `semantic`, `otio_export`
- `asr_engine` → `semantic`, `summary_engine`
- `multimodal_engine` → `face_engine`, `semantic`
- `theme_cluster` → `db.operations`
- **Impacto:** Não é possível extrair um módulo sem puxar meio sistema junto.

### 9. Falta de Camada de Serviço (Service Layer) (Crítico)
- Endpoints chamam **diretamente** funções de infraestrutura (DB, FFmpeg, APIs).
- Não há uma camada de "use cases" que orquestre a lógica de negócio.
- Exemplo: endpoint de busca faz SQL + Qdrant + merge + enriquecimento — tudo no handler.

### 10. Estado Global e Tratamento de Erro (Médio)
- `ACTIVE_CONVERSIONS`, `CONVERSION_PROGRESS`, `ACTIVE_CLUSTERING` — dicionários globais sem thread-safety explícita.
- Logs via `print()` espalhados por todo o código.
- Sem middleware de erro global no FastAPI. Cada endpoint trata exceção de forma diferente.

---

## 📋 PLANO DE IMPLEMENTAÇÃO — REFATORAÇÃO MODULAR

### **FASE 1: Fundação — Infraestrutura e Padrões**
*Objetivo: Criar as camadas base sem quebrar nada.*

**Task 1.1 — Criar `src/core/`**
- Mover `config.py` para `src/core/config.py`
- Criar `src/core/exceptions.py` com exceções customizadas (`CapIAuError`, `IngestError`, `TranscriptionError`, `APIError`)
- Criar `src/core/logging.py` com logger configurado (substituir `print()` gradualmente)
- Criar `src/core/constants.py` para enums (`VideoType`, `Status`, `DocType`)

**Task 1.2 — Criar Gerenciador de Conexão DB**
- Criar `src/db/connection.py` com context manager `get_db()` usando `contextlib.contextmanager`
- Substituir o padrão repetitivo `get_connection()` + `try/finally` em todos os repositories

**Task 1.3 — Criar Parser de JSON Markdown Universal**
- Criar `src/nlp/json_parser.py` com `extract_json_from_markdown(text: str) -> dict`
- Substituir parser duplicado em `theme_cluster.py`, `multimodal_engine.py`, `summary_engine.py`

**Task 1.4 — Criar Cliente LLM Genérico**
- Criar `src/nlp/llm_client.py` com classe `OpenRouterClient` que encapsula `requests.post`, headers, timeout, retry
- Refatorar `theme_cluster.py`, `summary_engine.py`, `chatbot` em `server.py` para usar este cliente

---

### **FASE 2: Backend — Camada de Dados (Repository Pattern)**
*Objetivo: Isolar SQL em classes Repository.*

**Task 2.1 — Criar Base Repository**
- `src/db/repositories/base.py`: classe `BaseRepository` com `self._execute()`, `self._fetchone()`, `self._fetchall()`

**Task 2.2 — Criar Repositories Especializados**
- `src/db/repositories/project.py` — `ProjectRepository` (CRUD projeto, drive_link)
- `src/db/repositories/video.py` — `VideoRepository` (CRUD vídeo, status, metadados)
- `src/db/repositories/photo.py` — `PhotoRepository` (CRUD foto, proxy, status)
- `src/db/repositories/transcript.py` — `TranscriptRepository` (palavras, diálogos, split)
- `src/db/repositories/theme.py` — `ThemeRepository` (temas, relações)
- `src/db/repositories/timeline.py` — `TimelineRepository` (cortes, sequências)
- `src/db/repositories/document.py` — `DocumentRepository` (docs de produção)
- `src/db/repositories/face.py` — `FaceRepository` (rostos, bounding boxes)
- `src/db/repositories/relation.py` — `RelationRepository` (grafo RDF-like)

**Task 2.3 — Refatorar `operations.py`**
- Migrar funções para repositories correspondentes
- `operations.py` vira um `__init__.py` que exporta as classes (compatibilidade temporária)
- Depreciar funções procedurais

---

### **FASE 3: Backend — Camada de Serviço (Service Layer)**
*Objetivo: Criar lógica de negócio desacoplada de HTTP e DB.*

**Task 3.1 — Criar Base Service**
- `src/services/base.py`: classe `BaseService` com injeção de repositories

**Task 3.2 — Criar Services por Domínio**
- `src/services/project_service.py` — CRUD projetos, import/export ZIP
- `src/services/ingest_service.py` — Orquestra ingestão: classificar arquivo → hash → metadata → proxy
- `src/services/proxy_service.py` — Geração de proxy vídeo/foto, cancelamento, progresso
- `src/services/transcription_service.py` — Orquestra: VAD → extrair áudio → AssemblyAI → salvar → indexar → resumir
- `src/services/vision_service.py` — Orquestra: extrair frames → detectar rostos → descrever via API → indexar → resumir
- `src/services/search_service.py` — Busca híbrida: Qdrant + SQLite (rostos, falantes) + merge + deduplicação
- `src/services/timeline_service.py` — CRUD timeline + export OTIO/XML/EDL
- `src/services/chat_service.py` — RAG: busca semântica + construção de contexto + chamada LLM
- `src/services/theme_service.py` — Clustering: buscar falas → prompt → parse → salvar relações
- `src/services/summary_service.py` — Resumos automáticos de entrevista/B-roll
- `src/services/document_service.py` — Upload, parse (txt/fdx/pdf), indexação
- `src/services/face_service.py` — Detecção Haar Cascade + registro
- `src/services/export_service.py` — ZIP export/import com reconstrução de IDs

**Task 3.3 — Criar Gerenciador de Tarefas**
- `src/tasks/executor.py` — `TaskExecutor` com ThreadPoolExecutor
- `src/tasks/progress_tracker.py` — `ProgressTracker` (substitui `ACTIVE_CONVERSIONS`, `CONVERSION_PROGRESS`)
- `src/tasks/cancel_manager.py` — `CancelManager` (substitui lógica de cancelamento espalhada)

---

### **FASE 4: Backend — Desmembrar API (Router Pattern)**
*Objetivo: Quebrar `server.py` em routers FastAPI.*

**Task 4.1 — Criar Schemas Pydantic Centralizados**
- `src/api/schemas/project.py`, `video.py`, `photo.py`, `timeline.py`, `search.py`, `chat.py`, `document.py`

**Task 4.2 — Criar Routers**
- `src/api/routes/projects.py` — `/api/projects`, `/api/projects/{id}`, drive_link
- `src/api/routes/videos.py` — `/api/videos`, `/api/video/{id}/transcribe`, `/api/video/{id}/vision`, retry, delete, cancel
- `src/api/routes/photos.py` — `/api/photos`, `/api/photo/{id}/analyze`, retry, delete
- `src/api/routes/ingest.py` — `/api/ingest/select-folder`, `/api/ingest/external`, watch
- `src/api/routes/search.py` — `/api/search`
- `src/api/routes/timeline.py` — `/api/timeline`, `/api/timeline/{id}/export/{format}`
- `src/api/routes/documents.py` — `/api/project/{id}/docs`, upload, delete
- `src/api/routes/chat.py` — `/api/project/{id}/chat`
- `src/api/routes/tasks.py` — `/api/conversions`, `/api/video/{id}/cancel-conversion`, `/api/project/{id}/retry-failed`
- `src/api/routes/faces.py` — `/api/face/{id}/label`, `/api/video/{id}/faces`, `/api/photo/{id}/faces`

**Task 4.3 — Criar Dependencies**
- `src/api/dependencies.py` — `get_db()`, `get_search_engine()`, `get_task_executor()`, `get_current_project()`
- Usar FastAPI `Depends` para injeção

**Task 4.4 — Criar Middleware**
- `src/api/middleware/error_handler.py` — Middleware global que captura `CapIAuError` e retorna JSON padronizado
- `src/api/middleware/logging.py` — `EndpointFilter` movido para cá

**Task 4.5 — Montar Aplicação**
- `src/api/server.py` vira um arquivo de ~50 linhas que apenas monta routers, middleware e static files

---

### **FASE 5: Backend — Refatorar Módulos de Infraestrutura**
*Objetivo: Separar concerns técnicos.*

**Task 5.1 — Refatorar `src/ingest/`**
- `src/ingest/scanner.py` — `scan_watch_folder()`, `watch_folder_loop()`
- `src/ingest/hasher.py` — `compute_hash()`
- `src/ingest/metadata.py` — `get_media_metadata()` (FFprobe)
- `src/ingest/file_classifier.py` — `classify_media_type()`

**Task 5.2 — Refatorar `src/media/`**
- `src/media/ffmpeg.py` — Wrapper FFmpeg/FFprobe (com startupinfo Windows)
- `src/media/proxy_generator.py` — `generate_proxy()`, `generate_photo_proxy()`
- `src/media/audio_extractor.py` — Extração MP3 mono para ASR
- `src/media/frame_extractor.py` — `extract_frame_ffmpeg()` (mover de `vision/`)

**Task 5.3 — Refatorar `src/vision/`**
- `src/vision/image_encoder.py` — `encode_image_base64()`
- `src/vision/llm_vision.py` — `call_openrouter_vision()` (prompt template separado)
- `src/vision/analyzer.py` — `analyze_broll_video()`, `analyze_set_photo()` (orquestrados por `VisionService`)

**Task 5.4 — Refatorar `src/transcription/`**
- `src/transcription/vad.py` — `detect_voice_activity_offline()` (mover de `asr_engine.py`)
- `src/transcription/asr_client.py` — Wrapper AssemblyAI
- `src/transcription/pipeline.py` — Orquestração (movida para `TranscriptionService`)

**Task 5.5 — Refatorar `src/search/`**
- `src/search/qdrant_client.py` — Wrapper Qdrant
- `src/search/embeddings.py` — SentenceTransformers
- `src/search/semantic.py` — `SemanticSearch` refatorado para usar wrappers

**Task 5.6 — Refatorar `src/export/`**
- `src/export/otio_adapter.py` — Factory de adapters OTIO
- `src/export/xml_adapter.py`, `edl_adapter.py`
- `src/export/zip_exporter.py` — ZIP export/import

---

### **FASE 6: Frontend — Modularização JavaScript**
*Objetivo: Quebrar `app.js` monolítico.*

**Task 6.1 — Criar Serviço de API**
- `src/ui/js/api.js` — Classe `CapIAuAPI` com métodos para cada endpoint (`fetchProjects()`, `fetchVideos()`, etc.)
- Centralizar base URL, headers, error handling

**Task 6.2 — Criar Gerenciamento de Estado**
- `src/ui/js/state.js` — Classe `AppState` com getters/setters e event listeners (`onProjectChange`, `onVideoChange`)
- Substituir variáveis globais espalhadas

**Task 6.3 — Criar Módulos de Domínio**
- `src/ui/js/player/controller.js` — JKL, play/pause, scrubber, speed overlay
- `src/ui/js/player/markers.js` — IN/OUT, append to timeline
- `src/ui/js/library/tree.js` — Construção e renderização da árvore de arquivos
- `src/ui/js/library/videos.js` — Cards de vídeo, filtros, ordenação
- `src/ui/js/library/photos.js` — Cards de foto, carrossel
- `src/ui/js/panels/transcript.js` — Renderização de diálogos, split, scissors mode
- `src/ui/js/panels/vision.js` — Frames de B-roll
- `src/ui/js/panels/search.js` — Busca semântica, highlight de termos
- `src/ui/js/panels/tasks.js` — Fila de tarefas (agrupado/detailed)
- `src/ui/js/panels/chat.js` — Chatbot RAG
- `src/ui/js/panels/themes.js` — Temas narrativos
- `src/ui/js/modals/photo_viewer.js` — Carrossel, zoom, rostos
- `src/ui/js/modals/project.js` — CRUD projeto
- `src/ui/js/modals/sync.js` — Import/export ZIP

**Task 6.4 — Criar Utilitários**
- `src/ui/js/utils/timecode.js` — `formatTimecode()`
- `src/ui/js/utils/dom.js` — Helpers de criação de elementos
- `src/ui/js/utils/mocks.js` — `MOCK_VIDEOS`, `MOCK_TRANSCRIPT_1`, etc. (separados)

**Task 6.5 — Entry Point**
- `src/ui/js/main.js` — Inicialização: `new App()` que monta todos os módulos

**Task 6.6 — HTML**
- Manter `index.html` como está (ou dividir em templates se usar bundler), mas carregar scripts como módulos ES6: `<script type="module" src="js/main.js"></script>`

---

### **FASE 7: Testes e Qualidade**
*Objetivo: Garantir que a refatoração não quebrou.*

**Task 7.1 — Testes Unitários Backend**
- `tests/repositories/` — Testar cada Repository com DB em memória (`:memory:`)
- `tests/services/` — Testar Services com repositories mockados
- `tests/api/` — Testar routers com `TestClient` do FastAPI

**Task 7.2 — Testes de Integração**
- `tests/integration/test_ingest_pipeline.py` — Ingest → Proxy → Metadata
- `tests/integration/test_transcription_pipeline.py` — VAD → ASR → Index
- `tests/integration/test_search_pipeline.py` — Index → Search → Results

**Task 7.3 — Testes Frontend**
- `tests/ui/` — Testes de componentes com Jest ou Vitest (opcional, se usar bundler)

---

### **FASE 8: Cleanup e Documentação**
*Objetivo: Remover código morto e documentar.*

**Task 8.1 — Remover código morto**
- Deletar funções não utilizadas em `operations.py`
- Remover mock data do `app.js` original (migrado para `mocks.js`)
- Remover `print()` statements (substituir por logging)

**Task 8.2 — Documentar arquitetura**
- Atualizar `README.md` com novo diagrama de camadas
- Criar `ARCHITECTURE.md` explicando: API → Service → Repository → DB

---

## 🚀 PROMPT PARA OUTRO CHAT

Copie e cole este prompt em um novo chat para que outro agente execute a refatoração:

```
Você é um engenheiro de software sênior especialista em arquitetura limpa (Clean Architecture), Domain-Driven Design (DDD) e modularização de código Python/FastAPI e JavaScript vanilla.

CONTEXTO:
Estou refatorando o projeto "CapIAu-Talho" — um motor de inteligência cinematográfica para documentários que usa FastAPI no backend, SQLite + Qdrant, FFmpeg, e JavaScript vanilla no frontend.

O código atual está no GitHub: https://github.com/fernangcortes/capiau-talho-v03

PROBLEMAS IDENTIFICADOS (analise profundamente antes de começar):
1. `src/api/server.py` é um GOD FILE de ~700 linhas com TODOS os endpoints misturando lógica de negócio inline
2. `src/db/operations.py` é um FAT MODEL de ~400 linhas com CRUD de TODAS as tabelas sem separação por domínio
3. `src/ui/app.js` é um MEGA-ARQUIVO de ~1500+ linhas com TODA a UI (player, busca, chat, timeline, fotos, etc.)
4. `src/ingest/watcher.py`, `src/transcription/asr_engine.py`, `src/vision/multimodal_engine.py` são pipelines monolíticos com múltiplas responsabilidades
5. Não há camada de Service (business logic) — endpoints chamam diretamente infraestrutura
6. Acoplamento circular entre módulos
7. Parser de JSON markdown duplicado em 3 arquivos
8. Estado global (dicionários) sem gerenciamento centralizado
9. Mock data inline no frontend
10. Sem testes unitários para a maioria dos módulos

ARQUITETURA ALVO (Clean Architecture / Modular):

Backend:
```
src/
├── api/
│   ├── dependencies.py          # Injeção de dependências FastAPI
│   ├── middleware/
│   │   ├── error_handler.py     # Middleware global de erro
│   │   └── logging.py
│   ├── routes/
│   │   ├── projects.py
│   │   ├── videos.py
│   │   ├── photos.py
│   │   ├── ingest.py
│   │   ├── search.py
│   │   ├── timeline.py
│   │   ├── documents.py
│   │   ├── chat.py
│   │   └── tasks.py
│   └── schemas/
│       ├── project.py, video.py, photo.py, timeline.py, search.py, chat.py, document.py
├── core/
│   ├── config.py
│   ├── exceptions.py
│   └── logging.py
├── db/
│   ├── connection.py            # Context manager get_db()
│   ├── schema.py
│   └── repositories/
│       ├── base.py
│       ├── project.py, video.py, photo.py, transcript.py, theme.py, timeline.py, document.py, face.py, relation.py
├── services/                    # CAMADA DE SERVIÇO (Business Logic)
│   ├── base.py
│   ├── project_service.py
│   ├── ingest_service.py
│   ├── proxy_service.py
│   ├── transcription_service.py
│   ├── vision_service.py
│   ├── search_service.py
│   ├── timeline_service.py
│   ├── chat_service.py
│   ├── theme_service.py
│   ├── summary_service.py
│   ├── document_service.py
│   ├── face_service.py
│   └── export_service.py
├── tasks/
│   ├── executor.py
│   ├── progress_tracker.py
│   └── cancel_manager.py
├── ingest/
│   ├── scanner.py, hasher.py, metadata.py, file_classifier.py
├── media/
│   ├── ffmpeg.py, proxy_generator.py, audio_extractor.py, frame_extractor.py
├── nlp/
│   ├── llm_client.py, json_parser.py, prompt_templates.py, theme_cluster.py, summary_engine.py
├── vision/
│   ├── image_encoder.py, llm_vision.py, face_engine.py
├── search/
│   ├── qdrant_client.py, embeddings.py, semantic.py
└── export/
    ├── otio_adapter.py, xml_adapter.py, edl_adapter.py, zip_exporter.py
```

Frontend:
```
src/ui/
├── js/
│   ├── main.js                  # Entry point
│   ├── api.js                   # Serviço de API centralizado
│   ├── state.js                 # Gerenciamento de estado
│   ├── player/
│   │   ├── controller.js        # JKL, play/pause
│   │   └── markers.js           # IN/OUT, timeline
│   ├── library/
│   │   ├── tree.js, videos.js, photos.js
│   ├── panels/
│   │   ├── transcript.js, vision.js, search.js, tasks.js, chat.js, themes.js
│   ├── modals/
│   │   ├── photo_viewer.js, project.js, sync.js
│   └── utils/
│       ├── timecode.js, dom.js, mocks.js
└── index.html
```

INSTRUÇÕES DE EXECUÇÃO:

1. Comece pela FASE 1 (Fundação): crie `core/`, `db/connection.py`, `nlp/json_parser.py`, `nlp/llm_client.py`
2. Depois FASE 2 (Repositories): crie todos os repositories com base em `db/operations.py` existente. Use `BaseRepository` para eliminar repetição de `get_connection()`/`try/finally`.
3. Depois FASE 3 (Services): crie services que orquestrem repositories e módulos de infraestrutura. NENHUM service deve importar FastAPI.
4. Depois FASE 4 (API Routes): quebre `server.py` em routers. Cada router deve ter ~100-150 linhas. Use `Depends` para injetar services.
5. Depois FASE 5 (Infraestrutura): refatore `ingest/`, `media/`, `vision/`, `transcription/`, `search/`, `export/` para serem libraries puras (sem dependência de FastAPI ou DB diretamente — recebam dados por parâmetro).
6. Depois FASE 6 (Frontend): quebre `app.js` em módulos ES6. Use `type="module"` no HTML. Crie `api.js` e `state.js` primeiro.
7. Mantenha compatibilidade com o schema SQLite existente. NÃO altere tabelas.
8. Use logging (`logging.getLogger(__name__)`) em vez de `print()`.
9. Crie exceções customizadas em `core/exceptions.py` e use-as nos services.
10. Para cada arquivo criado, adicione docstrings explicando a responsabilidade.

REGRAS CRÍTICAS:
- NÃO crie novas funcionalidades. Apenas reorganize o código existente.
- NÃO altere a lógica de negócio. Mantenha os mesmos algoritmos, prompts e fluxos.
- NÃO quebre o funcionamento atual. O sistema deve continuar funcionando igual após a refatoração.
- Cada service deve ser testável unitariamente (sem depender de FastAPI, SQLite real, ou APIs externas).
- Cada repository deve usar apenas SQLite (sem lógica de negócio).
- NENHUM arquivo deve ter mais de 250 linhas. Se precisar, divida em mais módulos.

Ao final, forneça:
1. A estrutura de arquivos completa (tree)
2. O código de todos os arquivos novos e refatorados
3. Um `requirements.txt` atualizado (se necessário)
4. Instruções de como rodar o projeto refatorado
```

---

> Este plano transforma o CapIAu-Talho de um **MVP monolítico** em uma **arquitetura limpa e modular**, mantendo 100% da funcionalidade existente. Cada fase pode ser executada independentemente, permitindo refatorar gradualmente sem parar o desenvolvimento.
