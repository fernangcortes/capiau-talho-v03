# Estágio 1B — Saneamento Crítico de Segurança, Banco, Sync & Baseline de Testes

> **Contexto:** Documento operacional e de arquitetura aplicada para o **Estágio 1B** derivado de [`GRANDE_PLANO_UNIFICADO_2026-11.md`](../../planos/GRANDE_PLANO_UNIFICADO_2026-11.md), [`plano-de-refatoracao-capiau-talho.md`](../../plano-de-refatoracao-capiau-talho.md) e [`PLANO_NUVEM.md`](../../planos/PLANO_NUVEM.md), consolidando sobre a base pós-Estágio 0 (`a1dc7b2`).
> **Escopo:** Entregáveis **`SEC-01`**, **`SEC-02`**, **`DATA-01`**, **`DATA-02`**, **`NUV.43`** e **`TEST-01`** (sem refatoração de estado da timeline do Estágio 1A e sem serviços multiusuário na nuvem do Estágio 7).
> **Regra obrigatória:** O SQLite é a **fonte de verdade**; nunca rodar I/O externo (Qdrant, S3, cópia pesada de proxies) dentro de transação aberta do SQLite, e preservar paridade das rotas locais com validação estrita de `Host`/`Origin`/token, confinamento de paths e limites de streaming.

---

## Resumo dos Entregáveis do Estágio 1B

| Código | Frente | Problema Central Eliminado | Módulos Principais | Suíte / Verificação |
| :--- | :--- | :--- | :--- | :--- |
| **`SEC-01`** | Fronteira HTTP & Exports | Rotas sensíveis abertas sem token; ZIP salvo em `EXPORTS_DIR`; `/cache` desalinhado | `src/api/security.py`, `src/api/server.py`, rotas em `src/api/routes/`, `src/ui/js/api.js`, `src/ui/js/modelosLocais.js` | `pytest tests/test_estagio_1b_seguranca.py` |
| **`SEC-02`** | Uploads, ZIP, Storage Guards & `eval()` | Path traversal, leitura integral em RAM, zip-bomb, `F:/` hardcoded e `eval()` no FFprobe | `src/api/security.py`, `src/api/routes/{media,projects,narrative}.py`, `src/core/storage_guards.py`, `src/media/ffmpeg.py`, `audio_*.py`, `midia.py` | `pytest tests/test_estagio_1b_seguranca.py tests/test_estagio_1b_media_guards.py` |
| **`DATA-01`** | Integridade Export/Import | Export cobrindo apenas parte das tabelas, mutação `_imp_` de hash, falha em `sequence_json` v2 e `photo_{id}.webp` | `src/services/sync.py`, `src/api/routes/projects.py` | `pytest tests/test_project_export.py tests/test_estagio_1b_db_sync.py` |
| **`DATA-02`** | Consistência SQLite WAL, Backup & Qdrant | Cópia direta de `.db` ativo em WAL, Qdrant silencioso e `operations.py` sem WAL/timeout | `src/db/backup.py`, `src/db/connection.py`, `src/db/operations.py`, `src/services/sync.py` (`qdrant_outbox`), `src/api/server.py` | `pytest tests/test_estagio_1b_db_sync.py tests/test_database.py` |
| **`NUV.43`** | Schema Versionado & Unicidade por Projeto | Ausência de `PRAGMA user_version` e `UNIQUE` global em `video.hash`, `photo.hash` e `theme.title` | `src/db/schema.py`, `src/db/repositories/media.py` | `pytest tests/test_estagio_1b_db_sync.py tests/test_bloco_0c_higiene_seguranca.py` |
| **`TEST-01`** | Baseline Reproduzível | Ausência de markers formais no `pytest.ini` e de scripts de teste no `package.json` | `pytest.ini`, `package.json`, `tests/auth_helpers.py` | `pytest --markers` e `npm run test:ui:smoke` |

---

## 1. `SEC-01` — Autenticação Local (`/api/auth/local-token`), Fronteira Loopback e Isolamento de Exports/Cache

1. **Núcleo de autenticação e validação de fronteira (`src/api/security.py`, `src/api/server.py`):**
   * *Problema:* A API não exigia credencial em rotas privilegiadas (ingestão por caminho do host, configurações globais, instalação de pacotes/modelos, backup S3 e chamadas de LLM/chat), permitindo abuso por páginas externas ou requisições cross-origin. Além disso, `/cache` apontava para `CONFIG.BASE_DIR / "data/cache"` em vez de `CONFIG.CACHE_DIR` e `server.py` não tinha ponto de entrada padrão com loopback `127.0.0.1`.
   * *Arquitetura aplicada:*
     * `get_local_token()` lê `CAPIAU_LOCAL_TOKEN` do ambiente ou gera uma vez por processo com `secrets.token_urlsafe(32)`, persistindo fora de pastas montadas estaticamente em `Path(CONFIG.DB_PATH).parent / ".local_token"` (permissão `0o600` em sistemas POSIX), além de bloqueio explícito (`404`) de dotfiles em `/cache`, `/proxies`, `/originals` e `/exports`.
     * `validate_local_host_and_origin(request)` rejeita com `403` cabeçalhos `Host` fora de `127.0.0.1`, `localhost`, `::1` (aceitando `testserver` apenas quando `client.host == "testclient"`, além de extras em `CAPIAU_ALLOWED_HOSTS`) e qualquer `Origin` não loopback (`http://127.0.0.1:<porta>`, `http://localhost:<porta>`, `http://[::1]:<porta>`).
     * `GET /api/auth/local-token` em `src/api/server.py` exige `validate_local_host_and_origin(request)`, `is_loopback_client(request)` e `Sec-Fetch-Site != "cross-site"`, devolvendo `{"token": ...}` com `Cache-Control: no-store`.
     * `require_local_auth(request)` valida `Host`/`Origin` e compara o token recebido via `Authorization: Bearer <token>` ou `X-Capiau-Token` usando `hmac.compare_digest` (`401` se ausente/inválido).
     * Mount `/cache` corrigido para `CONFIG.CACHE_DIR` e bloco `if __name__ == "__main__":` inicializando `uvicorn.run("src.api.server:app", host=os.getenv("CAPIAU_HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")))`.
2. **Ponte automática no frontend (`src/ui/js/api.js`, `src/ui/js/modelosLocais.js`) e helper de testes (`tests/auth_helpers.py`):**
   * *Arquitetura aplicada:* `CapIAuAPI` mantém cache em memória (`_localToken`), `getLocalToken(forceRefresh)`, `clearLocalToken()` e `getAuthHeaders()`, anexando `Authorization: Bearer <token>` em `CapIAuAPI.request(...)`, `extractDocStructure(...)` e `onboardingChatStream(...)`, com **1 retry automático** em `401` para cobrir reinícios do servidor. `modelosLocais.js` usa `CapIAuAPI.getAuthHeaders()` no download de modelos (`POST /api/modelos/{modelo_id}/baixar`). Em testes Python, `tests/auth_helpers.py` expõe `auth_headers(extra=None)`.
3. **Exports temporários privados e rotas protegidas (`src/api/routes/`):**
   * *Arquitetura aplicada:* `POST /api/project/{project_id}/export` (`src/api/routes/projects.py`) não grava mais o ZIP em `CONFIG.EXPORTS_DIR`; cria o pacote em diretório temporário privado (`tempfile.mkdtemp(prefix="capiau_proj_export_")`), sanitiza o nome do projeto e remove o diretório via `BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True)` (e no bloco `except`).

| Roteador (`src/api/routes/`) | Rotas Protegidas por `Depends(require_local_auth)` | Rotas Mantidas Sem Token (Leitura/UI Local) |
| :--- | :--- | :--- |
| `server.py` | `GET /api/auth/local-token` (loopback + same-origin + `Sec-Fetch-Site != cross-site`) | `GET /api/health`, mounts estáticos e SPA `/` |
| `projects.py` | `POST /api/project/backup-db`, `POST /api/onboarding/chat`, `POST /api/onboarding/chat/stream`, `POST /api/onboarding/api-key` | CRUD básico de projetos/docs/fontes, `export`, `import` |
| `media.py` | `POST /api/ingest/select-folder`, `/api/ingest/select-files`, `/api/ingest/external`, `/api/ingest/external-files`, `/api/project/open-folder-in-explorer`, `/api/project/open-proxies-folder`, `/api/project/{project_id}/relink`, `/api/projects/{project_id}/relink`, `/api/video/{video_id}/relink`, `/api/project/{project_id}/analyze-all-vision`, `/api/video/{video_id}/analyze-all`, `/api/photo/{photo_id}/analyze-all` | Listagens de biblioteca, thumbs, stream e bins |
| `narrative.py` | `POST /api/project/{project_id}/chat`, `POST /api/timeline/ai-suggest`, `POST /api/render/revelar` | Consultas de busca/timeline/transcrição |
| `faces.py` | `GET /api/faces/pipeline/s3/status`, `POST /api/faces/pipeline/install-insightface` | Detecção, clusterização e thumbnails |
| `modelos.py` | `POST /api/modelos/{modelo_id}/baixar` | `GET /api/modelos` (catálogo público local) |
| `settings.py` | `GET /api/settings`, `PUT /api/settings/global`, `PUT /api/settings/project/{project_id}`, `POST /api/settings/global/reset`, `POST /api/settings/project/{project_id}/reset`, `POST /api/settings/preset`, `GET /api/settings/prompts`, `PUT /api/settings/prompts/{prompt_id}`, `DELETE /api/settings/prompts/{prompt_id}` | `GET /api/settings/registry` |
| `entities.py` | `POST /api/entities/project/{project_id}/enrich` | Listagem/curadoria de entidades |
| `scenes.py` | `POST /api/docs/{doc_id}/extract-structure` | Preview/consulta de cenas |

* *Verificação:* `.venv\Scripts\python.exe -m pytest tests/test_estagio_1b_seguranca.py tests/test_prompts.py tests/test_onboarding_agent.py tests/test_onboarding_stream.py tests/test_p0b_chat_qdrant.py tests/test_p2_extraction_executor.py tests/test_modelos_locais.py -q`.

---

## 2. `SEC-02` — Streaming Limitado, Confinamento de Uploads, Anti-Zip-Bomb, `storage_guards.py` e `Fraction`

1. **Validação estrita de nome de arquivo e confinamento (`src/api/security.py`):**
   * *Problema:* `upload_files_for_ingest`, `upload_document`, `import_timeline` e `import_project` aceitavam nomes crus de upload (risco de traversal/separadores) e liam arquivos inteiros em RAM ou extraíam ZIP sem limite de expansão/membros.
   * *Arquitetura aplicada:*
     * `validate_upload_filename(filename, allowed_exts)` valida o nome **cru antes de qualquer `Path(...).name`**: rejeita com `400` se vazio, com caracteres de controle/`\x00`, `..`, `/`, `\`, prefixo de drive (`C:` ou `:`) ou extensão fora da allowlist.
     * `resolve_confined_path(base_dir, filename)` resolve os caminhos reais e garante `target.is_relative_to(base_resolved)` (`400` se escapar).
     * `read_upload_bounded` e `stream_upload_to_file` leem em chunks de `64 KB` (`UPLOAD_CHUNK_SIZE`), interrompendo com `413` se exceder o teto e removendo arquivos parciais imediatamente. Em `media.py` (`/api/ingest/upload-files`), exceder quantidade de arquivos, teto individual ou teto total do lote apaga todos os arquivos gravados na requisição (zero órfãos).
     * `safe_extract_zip` verifica `zipfile.is_zipfile`, número máximo de membros, symlinks (`0o120000`), path traversal (`..`, `/`, `\`, drive), bytes declarados, bytes reais descompactados em chunks e razão de expansão (checagem acima de `1 MB` ou `max_ratio` explícito), limpando staging em falha (`400`/`413`).
   * *Rotas endurecidas:* `POST /api/ingest/upload-files` (`media.py`, allowlist `SUPPORTED_VIDEO | SUPPORTED_AUDIO | SUPPORTED_PHOTO`), `POST /api/project/{project_id}/docs` (`projects.py`, `{".txt", ".fountain", ".fdx", ".pdf"}`), `POST /api/project/import` (`projects.py`, `{".zip"}` + `safe_extract_zip`) e `POST /api/timeline/import` (`narrative.py`, `SUPPORTED_EXTENSIONS` = `{".otio", ".xml", ".edl"}`).

| Variável de Ambiente | Função Helper (`src/api/security.py`) | Padrão | Escopo Aplicado |
| :--- | :--- | :--- | :--- |
| `CAPIAU_MAX_UPLOAD_FILES` | `get_max_upload_files()` | `100` arquivos | Lote de `/api/ingest/upload-files` |
| `CAPIAU_MAX_MEDIA_UPLOAD_BYTES` | `get_max_media_upload_bytes()` | `4 GiB` | Arquivo individual em `/api/ingest/upload-files` |
| `CAPIAU_MAX_TOTAL_UPLOAD_BYTES` | `get_max_total_upload_bytes()` | `8 GiB` | Soma total do lote em `/api/ingest/upload-files` |
| `CAPIAU_MAX_DOC_UPLOAD_BYTES` | `get_max_doc_upload_bytes()` | `25 MiB` | Documentos em `/api/project/{id}/docs` |
| `CAPIAU_MAX_TIMELINE_UPLOAD_BYTES` | `get_max_timeline_upload_bytes()` | `50 MiB` | Importação em `/api/timeline/import` |
| `CAPIAU_MAX_IMPORT_ZIP_BYTES` | `get_max_import_zip_bytes()` | `2 GiB` | Upload ZIP em `/api/project/import` |
| `CAPIAU_MAX_ZIP_MEMBERS` | `get_max_zip_members()` | `10000` entradas | Contagem de membros em `safe_extract_zip` |
| `CAPIAU_MAX_ZIP_UNCOMPRESSED_BYTES` | `get_max_zip_uncompressed_bytes()` | `8 GiB` | Soma declarada e real extraída em `safe_extract_zip` |
| `CAPIAU_MAX_ZIP_RATIO` | `get_max_zip_ratio()` | `50.0` | Razão de expansão anti-zip-bomb em `safe_extract_zip` |

2. **Guardas configuráveis de armazenamento somente leitura (`src/core/storage_guards.py`):**
   * *Problema:* Hardcodes dispersos de `F:/` em módulos de áudio e render impediam configuração por ambiente, não protegiam volumes montados no Linux/macOS e duplicavam checagens.
   * *Arquitetura aplicada:* `src/core/storage_guards.py` centraliza:
     * `get_readonly_drives()`: lê `CAPIAU_READONLY_DRIVES` (padrão `("F",)` quando ausente para manter a trava do acervo bruto; `""` retorna `()` e desativa bloqueio por letra).
     * `get_readonly_paths()`: lê `CAPIAU_READONLY_PATHS` separado por `os.pathsep` (multiplataforma).
     * `_has_readonly_volume_marker(path)`: inspeciona ancestrais buscando arquivo sentinela `.capiau-readonly` ou `.capiau-volume` JSON com `"read_only": true`.
     * `check_readonly_destination(dest)` e `ensure_writable_destination(dest)` (levanta `ValueError` se protegido ou cria a pasta com `mkdir(parents=True, exist_ok=True)`).
   * *Consumidores unificados:* `src/export/audio_stems.py` (`_assegurar_destino_seguro`), `src/export/video_render/midia.py` (`assegurar_destino_seguro`), `src/media/audio_denoise.py` (`denoisar`) e `src/media/audio_chain.py` (`_validar_destino` — preservado 100% compatível com `cp1252` sem glifos proibidos).
3. **Remoção de `eval()` no FFprobe (`src/media/ffmpeg.py`):**
   * *Problema:* `get_media_metadata()` executava `eval(video_stream.get('r_frame_rate'))` sobre saída externa do FFprobe.
   * *Arquitetura aplicada:* Substituído por `_parse_frame_rate(raw)` usando `fractions.Fraction`, tratando frações (`"24000/1001"`, `"30/1"`), decimais/notação científica, `"0/0"`, `None`/vazio e rejeitando entradas inválidas ou payloads maliciosos retornando `0.0`.

* *Verificação:* `.venv\Scripts\python.exe -m pytest tests/test_estagio_1b_media_guards.py tests/test_audio_stems.py tests/test_audio_denoise.py tests/test_audio_chain.py tests/test_estagio_1b_seguranca.py -q`.

---

## 3. `DATA-01` & `NUV.43` — Schema Versionado (`PRAGMA user_version`), Unicidade por Projeto e Sync Completo

1. **Versionamento `PRAGMA user_version` e unicidade por projeto (`src/db/schema.py`, `src/db/repositories/media.py`):**
   * *Problema:* `init_db()` não registrava versão do schema (`NUV.43`), rodava apenas `if coluna not in cols`, e `video.hash`, `photo.hash` e `theme.title` tinham `UNIQUE` global, impedindo o mesmo arquivo/tema em projetos distintos e forçando mutações destrutivas no import.
   * *Arquitetura aplicada:*
     * `SCHEMA_VERSION = 1` com `get_schema_version(conn)` e `set_schema_version(conn, version)` via `PRAGMA user_version`.
     * `SCHEMA_SQL` atualizado para `UNIQUE(project_id, hash)` em `video` e `photo`, `UNIQUE(project_id, title)` em `theme`, além da nova tabela operacional `qdrant_outbox` com índice `idx_qdrant_outbox_status_project`.
     * Em `init_db(db_path)`: antes de migrar banco existente com `user_version < 1` e tabelas prévias, cria backup pré-migração via `create_consistent_sqlite_backup`; executa migração versionada `0 -> 1` inspecionando `sqlite_master` para reconstruir apenas as tabelas afetadas (`video`, `photo`, `theme`) com `PRAGMA foreign_keys = OFF`, preservando todas as colunas existentes, recriando índices (`idx_video_project`, `idx_video_hash`, `idx_video_virtual_folder`, `idx_video_color_profile`, `idx_photo_project`, `idx_photo_virtual_folder`, `idx_photo_burst_group`), validando `PRAGMA foreign_key_check` e gravando `PRAGMA user_version = 1` (mantendo compatibilidade com bancos parciais legados, como em `test_schema_face_embedding_em_banco_novo_e_migrado`).
     * `MediaRepository.add_video` e `MediaRepository.add_photo` (`src/db/repositories/media.py`) filtram duplicidade por `WHERE project_id = ? AND hash = ?`.
2. **Manifesto versionado e cobertura total de tabelas (`src/services/sync.py`):**
   * *Problema:* `SyncService` exportava apenas 12 tabelas, mutava hashes com `_imp_` e títulos de temas com `(Imp ...)`, quebrava no formato `dict` v2 de `sequence_json`, usava `photo_{id}.webp` em vez de `proxy_photo_{id}.webp` e gravava o SQLite antes de copiar os proxies físicos.
   * *Arquitetura aplicada:*
     * `SyncService.PROJECT_TABLES` e `SyncService.GLOBAL_EXCLUDED_TABLES` classificam todas as **31 tabelas** definidas em `SCHEMA_SQL`: **29 tabelas de dados do projeto** + **2 tabelas excluídas (`app_setting` global e `qdrant_outbox` operacional)**.
     * `SyncService.get_project_all_data(project_id)` inclui bloco `"manifest"` (`format: "capiau-project"`, `format_version: 2`, `schema_version: SCHEMA_VERSION`, `exported_at`, `tables`) e registra explicitamente `qdrant_status` (`ok` | `degraded`) e `qdrant_errors` para `broll_frames`.
     * `SyncService.import_project_package(data, staging_proxies_dir=None, proxies_dest_dir=None)` (com `import_project_all_data` delegando e gravando `SyncService.last_import_report`):
       1. Preserva hashes originais (sem `_imp_`) e títulos de `theme` (sem `(Imp ...)`).
       2. Suporta `sequence_json` tanto em **dict v2 (`{"version": 2, "clips": [...]}`)** quanto em lista v1, remapeando `video_id`, `photo_id` e `alternatives[].video_id`/`photo_id`.
       3. Remapeia chaves estrangeiras de todas as 29 tabelas (incluindo `photo.burst_group_id`, `entity.linked_entity_id` em dois passes, `video_keyframe.segment_id`, `triage_feedback.media_id`, `system1_decisao.media_id`, `scene.doc_id`, `script_extraction.doc_id`, `detected_object.*`, `dialogue_word.*`).
       4. Copia proxies físicos (`proxy_vid_{old}.mp4` -> `proxy_vid_{new}.mp4` e `photos/proxy_photo_{old}.webp`, com fallback legado `photos/photo_{old}.webp`, -> `photos/proxy_photo_{new}.webp`) via escrita atômica **antes de `conn.commit()`**; qualquer erro apaga arquivos recém-criados e executa `conn.rollback()`.
       5. Executa reindexação Qdrant **fora da transação SQLite (após `conn.commit()`)**.

| Classificação no `SyncService` | Quantidade | Tabelas Cobertas |
| :--- | :--- | :--- |
| **`PROJECT_TABLES`** (exportadas/importadas por projeto) | **29** | `project`, `media_bin`, `video`, `photo`, `production_doc`, `face`, `face_recognition`, `person`, `transcript`, `theme`, `transcript_theme`, `timeline`, `entity`, `entity_mention`, `theme_segment`, `media_segment`, `video_keyframe`, `triage_feedback`, `system1_decisao`, `scene`, `script_extraction`, `relation`, `project_setting`, `transcript_entity`, `video_metadata_history`, `audio_render`, `detected_object`, `dialogue_utterance`, `dialogue_word` |
| **`GLOBAL_EXCLUDED_TABLES`** (não exportadas no pacote) | **2** | `app_setting` (configurações/segredos globais da instância), `qdrant_outbox` (fila operacional local de reconciliação vetorial) |

* *Verificação:* `.venv\Scripts\python.exe -m pytest tests/test_project_export.py tests/test_estagio_1b_db_sync.py tests/test_bloco_0c_higiene_seguranca.py tests/test_database.py -q`.

---

## 4. `DATA-02` — Backup Consistente em WAL (`sqlite3.Connection.backup`), Restore e Outbox Qdrant

1. **Backup e restore atômicos (`src/db/backup.py`, `src/api/routes/projects.py`):**
   * *Problema:* Copiar diretamente o arquivo `.db` em modo WAL podia omitir páginas pendentes ou gerar cópia corrompida, e `/api/project/backup-db` sobrescrevia sempre a mesma chave no S3 sem validação de integridade.
   * *Arquitetura aplicada:*
     * `create_consistent_sqlite_backup(source_db, dest_db)` usa `sqlite3.Connection.backup()` para arquivo temporário no diretório de destino, executa `PRAGMA integrity_check` (levantando `RuntimeError` em caso de falha), calcula `sha256` e `size_bytes`, e finaliza com `os.replace`.
     * `restore_sqlite_backup(backup_db, target_db)` valida `PRAGMA integrity_check` do backup antes de restaurar via `sqlite3.Connection.backup()` com fallback atômico e limpeza de `-wal`/`-shm` quando substitui arquivo.
     * `POST /api/project/backup-db` grava backup consistente em diretório temporário, envia para chave versionada `backups/capiau_backup_YYYYMMDD_HHMMSS.db` e devolve `key`, `sha256` e `size_bytes`.
2. **Padronização de conexões SQLite (`src/db/connection.py`, `src/db/operations.py`):**
   * *Arquitetura aplicada:* Tanto `get_db()` quanto `get_connection()` abrem com `timeout=30.0`, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 30000` e `PRAGMA journal_mode = WAL` sempre que `str(db_path) != ":memory:"`.
3. **Outbox e reconciliação do Qdrant (`src/db/schema.py`, `src/services/sync.py`, `src/api/server.py`):**
   * *Arquitetura aplicada:* Se o Qdrant falhar ou estiver indisponível durante a reindexação pós-commit de um import, o evento é gravado em `qdrant_outbox` (`status='pending'`) e o relatório retorna `qdrant_status='pending_reindex'` e `qdrant_errors` (sem sucesso silencioso). `SyncService.process_qdrant_outbox(project_id=None)` reconcilia pendências de forma idempotente, e `GET /api/health` expõe `qdrant_outbox_pending`.

* *Verificação:* `.venv\Scripts\python.exe -m pytest tests/test_estagio_1b_db_sync.py tests/test_estagio_1b_seguranca.py -q`.

---

## 5. `TEST-01` — Baseline Reproduzível (`pytest.ini` e `package.json`)

1. **Markers formais no `pytest.ini`:**
   * Preservados `pythonpath = .`, `testpaths = tests`, `python_files = test_*.py`, `python_classes = Test*`, `python_functions = test_*`, registrando os 6 markers oficiais do `TEST-01`:

| Marker (`pytest.ini`) | Finalidade | Exemplo de Uso |
| :--- | :--- | :--- |
| `unit` | Testes unitários rápidos sem rede, modelos pesados ou subprocessos externos | `pytest -m unit -q` |
| `integration` | Testes de integração controlada (SQLite, filesystem temporário, FastAPI) | `pytest -m integration -q` |
| `models` | Testes que exigem modelos/pesos locais de IA baixados | `pytest -m "not models" -q` |
| `network` | Testes que exigem acesso à rede ou APIs externas | `pytest -m "not network" -q` |
| `slow` | Testes lentos (render FFmpeg, stress ou suítes extensas) | `pytest -m "not slow" -q` |
| `e2e` | Testes ponta a ponta de fluxos completos do produto | `pytest -m e2e -q` |

2. **Scripts reproduzíveis ESM no `package.json` (`"type": "module"` preservado):**

| Script (`npm run <nome>`) | Comando Executado | Escopo Coberto |
| :--- | :--- | :--- |
| `test:xss` | `node tests/autoteste_xss_sec03.mjs` | Sanitização XSS (`SEC-03`) em chat e popups da timeline |
| `test:nle:0a` | `node tests/autoteste_transform_overlay_manual_ctrl.mjs && node tests/autoteste_color_labels.mjs && node tests/autoteste_dock_model.mjs && node tests/autoteste_dock_tabs.mjs && node tests/autoteste_dock_group.mjs` | Suíte de verificação do Bloco 0A (Transform overlay, Task 22 Color Labels e Dock 0A) |
| `test:dock` | `node tests/autoteste_dock_model.mjs && ... && node tests/autoteste_panel_rail.mjs` | Suíte completa Drag & Dock (`model`, `ops`, `drag`, `tearoff`, `join`, `group`, `tabs`, `panel_collapse`, `panel_rail`) |
| `test:nle:core` | `node tests/autoteste_track_lock.mjs && node tests/autoteste_safe_margins.mjs && node tests/autoteste_match_frame.mjs && node tests/autoteste_aparencia.mjs && node tests/autoteste_welcome_hub.mjs` | Recursos NLE recentes (`Track Lock`, `Safe Margins`, `Match Frame`, `Aparência`, `Welcome Hub`) |
| `test:shortcuts:check` | `node scripts/gerar_atalhos.mjs --check` | Sincronia das tabelas e cartões de atalhos gerados |
| `test:ui:smoke` | `npm run test:xss && npm run test:nle:0a && npm run test:dock && npm run test:shortcuts:check` | Gate rápido combinado de interface Node ESM |

3. **Comandos consolidados de validação do Estágio 1B:**

```bash
# 1. Validar markers formais (TEST-01) e JSON do package.json
.venv\Scripts\python.exe -m pytest --markers
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"

# 2. Suítes Python do Estágio 1B (Segurança, Guards, Banco/Sync e Compatibilidade)
.venv\Scripts\python.exe -m pytest tests/test_estagio_1b_seguranca.py tests/test_estagio_1b_media_guards.py tests/test_estagio_1b_db_sync.py tests/test_project_export.py tests/test_bloco_0c_higiene_seguranca.py tests/test_database.py -q

# 3. Suítes afetadas por Bearer auth e consumers de áudio/docs
.venv\Scripts\python.exe -m pytest tests/test_prompts.py tests/test_onboarding_agent.py tests/test_onboarding_stream.py tests/test_p0b_chat_qdrant.py tests/test_p2_extraction_executor.py tests/test_modelos_locais.py tests/test_audio_stems.py tests/test_audio_denoise.py tests/test_audio_chain.py tests/test_docs_sincronizadas.py -q

# 4. Baseline Node ESM (TEST-01) e lint de documentação
npm run test:ui:smoke
npm run test:nle:core
.venv\Scripts\python.exe scripts/verificar_docs.py
```
