# Grande Plano Unificado CapIAu-Talho (Novembro/2026)

> **Data-base da auditoria:** 16/11/2026 sobre `main` (`7e82b92`) + planos HyperFrames de `origin/ccr-a5fc9a59-3gh91p` (em *stage* no Git) + levantamentos extraídos das 5 IAs do navegador ([`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md)).
> **Status atualizado em 17/11/2026 (`main` @ `11efef5`):** **Estágio 0 (`0A`, `0B`, `0C`)**, **Estágio 1A** e **Estágio 1B** **100% concluídos**; central e HTMLs explicativos das decisões adiadas entregues em [`docs/planos/explicativos/index.html`](./explicativos/index.html) (`d2a3437`); **Estágio 1C** **em andamento** com **Frente D1 (`E1–E2`) concluída** (`11efef5`), restando `D1 E3` e `Frente B Nível 1 + Video Receipts`.
> **Como usar este documento:** Este é o **ponto de partida vivo** do planejamento. Ele substitui a ordenação anterior de 18/10 ([`ORDEM_DE_IMPLEMENTACAO.md`](./ORDEM_DE_IMPLEMENTACAO.md)) com o estado real verificado no código por 5 frentes de auditoria paralelas, colocando **Quick Wins fáceis primeiro**, fechando **Saneamento mínimo de base** e atacando suas duas prioridades declaradas (**Ferramentas NLE** e **MCP multi-harness**) sem gerar retrabalho com o HyperFrames nem com o acoplamento do estado global da timeline. A cada bloco iniciado, abra o plano detalhado correspondente na **Seção 4 (Lista Resumida Mestre)** para refinar e executar.

---

## 1. Raio-X do Projeto: Implementado × Desatualizado × Bugs Descobertos

### 1.1 O que JÁ está implementado na `main` (`7e82b92`)

* **Suite NLE Clássico (`src/ui/js/`, `src/export/video_render/`):**
  * **Tasks 0 a 18** implementadas e cobertas por suíte de autotestes (`79` arquivos `tests/autoteste_*.mjs`).
  * **Task 23 (Track Lock)** implementada no commit `0799f7e` (`panels.js:3692, 3787`, `styles.css:8768-8784`, `tests/autoteste_track_lock.mjs`).
  * **Task 24 (Safe Margins)** implementada no commit `3d5813c` (`#btn-program-safe-margins`, `computeSafeMarginsGeometry`, `syncSafeMarginsOverlay`, `tests/autoteste_safe_margins.mjs`).
* **Viewport, Transform e Crop:** Fases `0` (0.1–0.6), `1` (quase completa), `2` (parcial), `3`/`3b` (zoom 10%–1000%, pan, minimapa e scrollbars), `4` (overlay manual via `Ctrl+Clique` com 8 alças, rotação e âncora, com 1 bug ativo no arraste) e `5` parcial (sliders `data-crop`, `clipPath` e `geometria.filtros_crop`).
* **UI, Tema Neutro & Drag/Dock:**
  * Tema Neutro `F0–F3` + Rodada `3/3b` (`theme.css`, `themeBoot.js`, `themeManager.js`, `themeTokens.js`, `appearanceWindow.js`, `trackColors.js`, `headerMenus.js`, `panelRail.js`, 5 fontes OFL em `src/ui/fonts/`, chaves `ui.*` em `settings_registry.py:1045-1135`).
  * Drag & Dock `F0–F5` + `F2c` (`dockModel.js`, `dockOps.js`, `dockDrag.js`, `popoutRestore.js`, `tabPanels.js`, `panelCollapse.js`, `workspaceManager.js`).
* **Áudio, Cor e Render:**
  * Preservação de `renderCache` no undo/redo (`8cda2b4`); correções antigas `f77ce35` (janela de desfoque) e `db5e024` (camada de ajuste).
  * `PLANO_COR_OCIO.md` **Fase 0** quase completa (`COLOR_KEYS` em `src/media/ffmpeg.py:13-35`, `src/color/deteccao.py:1-186`, `scripts/auditar_cor.py`).
  * `audio_denoise.py` com dois motores ONNX via `sherpa_onnx` (`dpdfnet` 48 kHz RTF `0.82` e `gtcrn` 16 kHz RTF `0.28`) no `worker_audio.py`; `PLANO_AUDIO_CATEGORIAS.md` **Camadas 1–3** em produção (`natureza.py`, `audio_classificador.py` com PANNs, desvio de ASR em `pipeline.py:981-1060`); base Auphonic (`audio_analysis.py`, `audio_chain.py`, `audio_cloud.py`).
* **Buscas, Roteiro, Triagem & Análise IA:**
  * `PLANO_IMPLEMENTACAO.md`: Etapa 1 (`E1.T1–T8`), Etapa 2 (`segmentation.py`, `media_segment`, `ImageSearch`/CLIP, burst `0.80/10`, perfis, paletas, backend de facetas em `narrative.py:176-406`), `P0/P0.6`, `P1.1–P1.3`, `P2` (`script_format.py`, `script_extract.py`, `scene`, curadoria).
  * `ORDEM_DAS_ANALISES.md` §6, `REVISAO_CATEGORIAS.md` (Proposta B `8 + fora_do_projeto`, `triagem_rodada.py`, `triagem_relatorio.py`, `jev_verificar.py`), tabelas `detected_object`/`system1_decisao`, `spatial_grounding.py`, `detectores.py`, `system1_service.py` (pilotos Laya/Jev + `audit_timeline_mutation`), `motores.py` (`venv_nemo_worker.py`), `LocalBackend`, scripts offline de `08_plano_sequencia.md`.
* **Documentação & Build:** `git` no `Dockerfile:20` (`3d21b4a`), reorganização de `docs/`, `scripts/gerar_docs_api.py`, `scripts/gerar_atalhos.mjs`, `scripts/verificar_docs.py`, `tests/test_docs_sincronizadas.py`, `site/` e `.github/workflows/site.yml` (PR #6), `NUV.1` em `src/config.py:109-116`.
* **Entregas pós-auditoria já incorporadas na `main` (`7e82b92..11efef5`):**
  * **Estágio 0A (`ae252e0`, `a59fc02`):** fix do arraste manual das alças (`player.js`), botão Configurações da Sequência (`expandInspectorPanel`), trava par-a-par de Crop `<= 90%`, `syncProgramViewport()`, `fps/width/height` no `TIMELINE_HISTORY`, unificação do auto-config do 1º clipe, micro-ajustes Drag & Dock (`DOCK.3, 4, 5, 9, 15, 31, 33`) e **Task 22 (Color Labels)** + autotestes (`autoteste_color_labels.mjs`, `autoteste_transform_overlay_manual_ctrl.mjs`).
  * **Estágio 0B (`9972298`, `ead9c01`, `4b5c023`, `dbfddf3`, `945b843`):** `Frente A E0` (EQ Q-factor + compensação mono `−3 dB`), fix do último quadro com `eof_action=pass`, ramo dedicado `video_dip_white`, alinhamento do `gblur` de clipe aos títulos e `LinearTimeWarp` no `otio_export.py`.
  * **Estágio 0C (`44077f0`, `1c4848a`, `8cc01fa`, `2e57224`, `a1dc7b2`):** CORS restrito à origem local, `--reload` isolado sob `-Dev`, sanitização XSS (`SEC-03`), coluna `face.embedding` no schema + migração, limpeza de chaves mortas e conexão de `hardware.ai_device`, checagem real de Edge/Chrome no preflight, dependências no `requirements.txt` e sincronia documental pós-PR #6.
  * **Estágio 1A (`5e05296`):** extração de `TimelineSequenceState` por instância, `SequenceManager` e fachada `Proxy` compatível em `timelineState.js` + `tests/autoteste_timeline_sequence_state.mjs`.
  * **Estágio 1B (`98656c7`, `5561def`, `d4957d1`, `4678990`, `6b17c9c`):** remoção de `eval()` no `ffprobe` e guardas somente leitura (`src/core/storage_guards.py`), schema versionado com `PRAGMA user_version` + backup consistente em WAL (`src/db/backup.py`), `sync.py` cobrindo todas as tabelas + timeline v2 + proxies antes do commit + outbox do Qdrant, e segurança local Bearer (`src/api/security.py`) + isolamento de `/cache` e exports + blindagem contra path traversal e zip-bomb.
  * **Estágio 1C parcial — Frente D1 `E1–E2` (`11efef5`):** pacote `src/navegador/` com servidor HTTP loopback `127.0.0.1` (`servidor.py`, token, Range, PUT atômico, origem segura), lançador Playwright (`lancador.py`), diagnóstico barato e completo (`diagnostico.py`, rotas `/api/navegador/diagnostico` e `/api/navegador/testar`), limpeza/varredura de processos órfãos (`orfaos.py` + `lifespan` em `server.py` e `TASK_MANAGER`) e suíte `tests/test_navegador_servidor.py` + `tests/test_navegador_lancador.py`.

---

### 1.2 Desatualizado, Superado ou em Conflito entre Planos

| Plano / Documento | O que ficou desatualizado ou em conflito com a realidade do código (`7e82b92`) e novos planos |
|---|---|
| [`ORDEM_DE_IMPLEMENTACAO.md`](./ORDEM_DE_IMPLEMENTACAO.md) | Escrito em 18/10: não conhece as **9 frentes HyperFrames**, já concluiu Tasks 23 e 24, não inclui `plano-de-refatoracao-capiau-talho.md` nem os 11 achados das IAs. **Substituído por este documento como bússola geral.** |
| [`PLANO_SUITE_NLE_CLASSICO.md`](./PLANO_SUITE_NLE_CLASSICO.md) (Tasks 19–21) | **Conflito direto com HyperFrames `F` e `A`:** Task 20 (`audioKeyframes` em frames + WebAudio) e Task 21 (auto-ducking dinâmico ao vivo sem paridade FFmpeg) estão **superadas pela Frente F** (`clip.keyframes.volume` + ducking determinístico via `transcript`). Task 19 (VU Meter `AnalyserNode`) deve esperar a extração de `audioCadeia.js` (`Frente A` Etapa 1) para não duplicar `createMediaElementSource`. |
| [`PLANO_COR_OCIO.md`](./PLANO_COR_OCIO.md) | **Conflito parcial com Frente G:** substituir `cadeia.py` (segundo proxy derivado) por `src/color/transformacao.py::filtro_entrada` assando direto no proxy 720p (`G2b/G3b`); substituir `auto_grade.py` por LLM pela sugestão analítica P10/P90 (`sugestao.py`, `G4`). Preservar exclusivamente `§0.3/§1.2` (`CR2 no_auto_bright`), `§2.1` (`ocio_manager.py` gerando `.cube` ACES sob demanda para `G3a`), `§1.4/§1.5/§1.7/§3.2` (facetas, continuidade, OTIO). |
| [`PLANO_MODERNIZACAO_ANALISES_IA_2026.md`](../Pesquisas/PLANO_MODERNIZACAO_ANALISES_IA_2026.md) | **Divergência severa com o código:** (1) declara SFace 128-d descontinuado e SCRFD+ArcFace ativo, mas `pipeline.py:45`, `face_engine.py:1,19,141,353` e `/api/faces/*` continuam em YuNet+SFace 128-d e `local_backend.py` cai silenciosamente em Sobel+histograma 512-d; (2) cita 19 prompts vs. **20 reais** no `PROMPT_REGISTRY`, deixando `photo_vision` e `triage_batch_title` como prompts mortos; (3) tabelas `dialogue_utterance`/`dialogue_word` nunca são gravadas; (4) Laya em sombra marcou `2/23` e `3/20`; (5) Canary (`1.5x` CPU + loop), Nemotron (4 falantes em 2) e SenseVoice (sem PT) falharam nos pilotos. |
| [`PLANO_EMBEDDINGGEMMA2.md`](./PLANO_EMBEDDINGGEMMA2.md) + branch `fgc/vigorous-boyd-f45fbc` | Branch já incorporada na `main` (apenas docs + fixes antigos, zero código de Gemma 2). Modelo FP32 pesado deve ser reavaliado frente a **`jinqiu193/trace` (`EmbeddingGemma 2 int8 ONNX`)** quando entrar essa onda. |
| [`PLANO_TEMA_NEUTRO.md`](./PLANO_TEMA_NEUTRO.md) | Cabeçalho aponta branch antigo; código usa `--t-surface-0..4`, `--fs-4..--fs-32`, `localStorage["capiau.themeState"]` e 5 fontes (não `--surface-0..4` / `BroadcastChannel`). Faltam fontes no Canvas 2D (`timelineRenderer.js`) e `--space-scale` na UI. |
| [`PROPOSTA_BUSCA_OBJETOS.md`](../propostas/PROPOSTA_BUSCA_OBJETOS.md) & [`PLANO_IMPLEMENTACAO.md`](./PLANO_IMPLEMENTACAO.md) | Cita taxonomia antiga (`obra` vs `cena`, 9 chaves) e burst `0.93` (atual: `0.80/10`); nada do roteador `buscar_objeto`/`groundingSearchRequested` foi conectado. |
| [`08_plano_sequencia.md`](../agentes/proximos_chats/08_plano_sequencia.md) | Diz "nada commitado", mas os 5 scripts offline já estão na `main`; falta integração com pipeline/SQLite/timeline. |
| Docs após 29/10 ([`AUDITORIA_DOCUMENTACAO_2026-10-29.md`](../dev/AUDITORIA_DOCUMENTACAO_2026-10-29.md)) | Parte já resolvida (`Dockerfile` `git`, reorganização `docs/`, workflows), porém pós-merge restaram divergências: `README.md` vs `wiki/02` e `wiki/16` (ainda mencionam Dockerfile pendente e `--reload`), `.gitignore:53-55` ainda ignora `docs/PLANO_*.md`/`docs/Pesquisas/`, e `src/vision/face_pipeline.py:7` ainda documenta Tier 0 como YuNet+SFace. |

---

### 1.3 Bugs Ativos e Lacunas Críticas Encontradas no Código (`7e82b92` → status em `11efef5`)

1. **Sequência Fantasma & Chat Agente (`D1–D6` 100% abertos + bug novo de bypass):**
   * **Bypass novo (`chat_agent.py:2275`):** `SET_AV_OFFSET` e `ADD_EFFECT` não constam na lista que ativa `is_preview = True`; se chamados sozinhos, aplicam edição sem confirmação.
   * **Abertos:** `D1` hit-test só na pista `"ai"` (`timelineInteraction.js:582-613`); `D2` `final_cuts`/`shadow_cuts` quebrados no front por incompatibilidade `in` vs `in_s` (`NaN`) e `suggestions_output = []`; `D3` `populateRoughCutMarkers` nunca chamado por `chat.js`; `D4` fallback `"V1"` vs `"V2"`; `D5` corte offline silencioso; `D6` fotos/textos/mattes perdem campos em `api.js:640`, `TimelineAISuggestClip` e `TimelineShadowCopy`.
2. **Paridade Player × Export (`17/17` defeitos HyperFrames abertos em `7e82b92` + bug novo):**
   * **Já resolvidos no Estágio 0B/0C:** ramo `video_dip_white` (`4b5c023`), export 1 frame a menos (`ead9c01`), EQ `highpass`/`bass`/`treble` + mono `−3 dB` (`9972298`), desfoque de clipe `gblur` (`dbfddf3`), `otio_export.py` `LinearTimeWarp` (`945b843`), CORS `*` (`44077f0`), textos/refs `requirements-opcional.txt` + `sherpa-onnx` no `requirements.txt` + preflight real Edge/Chrome (`2e57224`).
   * **Parcial no Estágio 1C (`11efef5`):** base `src/navegador/orfaos.py` + `lifespan` e `TASK_MANAGER` para Chromium órfão já implementados (`D1 E1–E2`), faltando migrar `titulos.py` e encerrar Chromium/thread daemon em `execucao.py:110-145` (`D1 E3`).
   * **Ainda abertos:** HD sem `bt709` e conversão RGBA sem `in_color_matrix=bt709`/`gbrp` (`4A`); compressor `knee=8` vs `"2,1 dB"` (`2B`); reverso 1 frame adiantado no player (`2C`); curva `"bezier"` não registrada (`decisão adiada`); **3+ pistas de vídeo ocupadas ocultam pista do meio no Program** (`2C`, `player.js:4131-4200`); `SRT/VTT` preso no JS morto (`4B`).
3. **NLE / UI & Segurança (`SEC`):**
   * **Já resolvidos no Estágio 0A/0C:** arraste das alças em modo manual (`player.js:6820-6823`), `#btn-seq-settings-program` (`main.js:3308`) e trava par-a-par de Crop `<= 90%` (`ae252e0`); sanitização XSS `SEC-03` em `timelineInteraction.js` e `chat.js` (`1c4848a`).
   * **Ainda aberto:** `#adj-volume-slider` vai até `200`, enquanto `player.js:5513` clampa `el.volume` em `1.0` (`2C`).
4. **Banco, Sync, Busca & Ambiente (`DATA` / `P0-P3`):**
   * **Já resolvidos no Estágio 0C/1B:** coluna `face.embedding` no `CREATE TABLE face` (`8cc01fa`); `--reload` fora do padrão nos scripts `.ps1`/Dockerfile/compose (`44077f0`); `sync.py` (30 tabelas, v2 de `sequence_json`, `proxy_photo_{id}.webp`, sem mutação `_imp_` e outbox Qdrant em `d4957d1`); `eval()` em `ffmpeg.py:62` e caminhos `F:/` hardcoded (`98656c7`).
   * **Ainda abertos:** `rag.py:205,234,288` faz `LIKE '%query inteira%'` para rostos/falantes (`5A`); `semantic.py:513` limita visão a `limit=100` sem paginação (`5A`); `s3_service.py` sem `endpoint_url` R2 (`7A`); `src/services/task_manager.py` citado em planos antigos não existe (real: `src/core/tasks.py`).

---

## 2. O que Entra das Novas IAs (e o que Fica Fora / Adiado)

* **Entra de forma prioritária (Estágios 1–4):**
  * **Arquitetura MCP Anti-Lock (5 Harnesses):** registro único de ferramentas tipadas (`src/tools/`, Pydantic, inspirado em *OpenReel/FilmCraft*) + **MCP Streamable HTTP (`/mcp`)** dentro do FastAPI (evitando o lock de arquivo do Qdrant embutido quando a GUI está aberta) + `stdio_bridge` fino + configs prontas para **Claude Code**, **Antigravity**, **Hermes Agent**, **Cursor** e **Gemini CLI**.
  * **UX de IA na Edição:** leitura do playhead/seleção (`WeftCut`), `preview_compare` + aba **Changes** (`CutVoke`), Undo atômico por turno da IA, **Frente H** de revisão de títulos (`HyperFrames`), contratos entre `TIMELINE_PERSONAS` (**MASS**) e contratos **MCP Inspector / `@vexyo/core`**.
  * **Índice de Sequência (`Sequence Index`):** painel tabular filtrável sobre a fachada `TIMELINE_STATE` + export CSV + salto para o corte.
  * **Disciplina e pós-checagem de Render:** **Video Receipts** (`Kinocut`) + pré-checagem/pós-validação **`proofcut`** (frames, duração, LUFS, conferência opcional de falas no MP4 final) + **smart cut** (`ffmpeg-skill`) em cortes sem efeitos.
* **Entra nos Estágios 5–6 (Inteligência & Conhecimento do Acervo):**
  * **`VideoSeek` pré-recorte de barras pretas estáticas** antes do CLIP/dHash (quick win para verticais/letterbox).
  * **`PP-OCRv6` via `RapidOCR 3.9` (CPU)** persistido em SQLite (claquete 2–3 fps nos 5s iniciais/finais → vínculo automático de cena) + compilação cacheada por hash de **`visual_memory.json`/`visual_memory.md`**.
  * **`Capitularização Multimodal`:** tabela dedicada `media_chapter` + markers persistentes/OTIO/`PySceneDetect save-chapters`.
  * **5 Visualizações Operacionais** (em duas sub-ondas: *Swimlane, Treemap, PCA+t-SNE* com `/api/media/similar-batch` já no `.venv`; *Matriz Cena×Material* e *Storyline* após `scene_media` + vínculo personagem↔pessoa).
  * **`Grafo de Decisões + talho-bench`:** acoplado a `system1_decisao` (estendendo por beat/segmento) + HMM/Viterbi + **MASS** torneio Bradley–Terry; nenhuma decisão automática de descarte antes de calibrar no `talho-bench`.
  * **`DeepFilterNet 3 ONNX`** e **`sherpa-onnx fa-models` / `VoxLock`** após benchmark local A/B.
* **Adiado / Condicionado / Descartado:**
  * **Descartado:** `RNNoise` no caminho offline (`gtcrn` RTF 0.28 já supre preview em CPU); auto-ducking WebAudio ao vivo (`Frente F` substitui); Obsidian como substituto da busca vetorial global (só para grafo curado após migrar `CHECK` da tabela `relation`).
  * **Aguarda decisão de design / banco de casa:** **Onda Lateral da Biblioteca** (20 perguntas abertas + regra *painel nunca cobre outro*), **`E1.T9` + ~506 vídeos + APIs pagas** (dependem do banco de casa/chaves).
  * **Estágio 7 / Sob demanda:** `PLANO_NUVEM.md` completo (`NUV.2..NUV.63`), `Editorial DNA` (`src/patterns/`), `Micro-Renders Híbridos + GPU BYOK/UEG + Blender MCP`, e satélites (B-roll multi-fonte, proxies Wi-Fi de set, Lumi-4B/needle2, ponte Resolve, MAM CriaLab).

---

## 3. Ordem Lógica Unificada (Estágios 0 a 7)

> Lógica da sequência: **(0) Colher Quick Wins fáceis + estancar bugs ativos** → **(1) Criar a base segura sem retrabalho (`TIMELINE_STATE` por instância + Sync/Segurança mínima + Regressão Nível 1)** → **(2) Fechar Ferramentas NLE** → **(3) Entregar MCP Multi-Harness + Sequência Fantasma** → **(4) Cor Técnica + Legendas + Parakeet/Proofcut** → **(5) Busca + OCR + Visualizações + Capítulos** → **(6) Decisão IA + Cor Criativa + WAAPI** → **(7) Nuvem + GPU Híbrida + Ecossistema.**

### Estágio 0 — Quick Wins Imediatos & Estancamento (3–5 dias) — ✅ CONCLUÍDO
> Roteiro cirúrgico executado a partir de [`09_quick_wins_estagio_0.md`](../agentes/proximos_chats/09_quick_wins_estagio_0.md) (100% livre de decisões pendentes).
1. **Estágio 0A — Quick Wins UI/NLE (~1–1,5 d) — ✅ CONCLUÍDO (`ae252e0`, `a59fc02`):**
   * Corrigir bug do arraste das alças em modo manual (`player.js:6820-6823`, não chamar `refreshClipInspector()` no `mousemove`).
   * Corrigir botão Configurações da Sequência com Inspetor recolhido (`main.js:3308` → `expandInspectorPanel()`).
   * Travar Crop em `left+right <= 90` e `top+bottom <= 90` (`timelineInteraction.js:6503-6511, 11242-11288`).
   * Micro-ajustes Drag & Dock/HTML (`DOCK.3, 4, 5, 9, 15, 31, 33`, `panel.html`/`panel-group.html` `styles.css?v=94`).
   * `syncProgramViewport()` no início de `syncVideoToPlayhead()`; `fps/width/height` no `TIMELINE_HISTORY._capture/_restore`; unificar bloco triplicado de auto-config do 1º clipe. *(Obs.: `--space-scale` na `AppearanceWindow` ficou adiado para decisão futura via HTML explicativo.)*
   * **Task 22 (Color Labels)** (~1 d): 8 cores no clipe + menu de contexto + renderer + `autoteste_color_labels.mjs` (incluindo fix de clipping no submenu em `a59fc02`).
2. **Estágio 0B — Quick Wins Render / Paridade Fila 0 (~1,5 d) — ✅ CONCLUÍDO (`9972298`, `ead9c01`, `4b5c023`, `dbfddf3`, `945b843`):**
   * `Frente A Etapa 0`: EQ `highpass width=1.122018`, shelves `width=0.5`, e `pan=stereo|c0=c0|c1=c0` em mono (`grafo_audio.py:407-413, 884`).
   * Export 1 frame a menos (`comando.py:717`) + validar com `ffprobe -count_frames`.
   * Implementar ramo **`video_dip_white`** em `grafo_video.py:536-658`.
   * Alinhar desfoque de clipe (`cor.py:229`) a `FATOR_SIGMA_DESFOQUE = 1.05, steps=4` (`titulos.py:65-66`).
   * `otio_export.py:230-299`: suporte a velocidade constante (`LinearTimeWarp`). *(Obs.: alinhamento de curva `"bezier"` vs `"s_curve"` foi movido para decisão futura via HTML explicativo antes da Frente F / Regressão Nível 1.)*
3. **Estágio 0C — Higiene Operacional, Segurança Básica & Schema (~1–2 d) — ✅ CONCLUÍDO (`44077f0`, `1c4848a`, `8cc01fa`, `2e57224`, `a1dc7b2`):**
   * CORS local em `server.py:66-72`; remover `--reload` padrão de `scripts/launch_capiau.ps1:83`, `scripts/run-local.ps1:35`, `Dockerfile:60` e `docker-compose.yml:8-9`.
   * Escapar HTML no chat/timelines (`chat.js:406-408, 732-775` e `timelineInteraction.js:13608+`, `SEC-03`).
   * Adicionar `face.embedding` ao `CREATE TABLE face` (`schema.py:108-127`).
   * Limpar chaves mortas de `proximos_chats/02` e conectar `hardware.ai_device`; corrigir falsos textos/imports (`settings_registry.py:170`, `modelos_locais.py:224`, `titulos.py:76-78`, declarar `pypdf`, `sherpa-onnx`, `soundfile`, `pytest`, `syrupy` no `requirements.txt`).
   * Alinhar `.gitignore:53-55`, `wiki/02`, `wiki/16` e docstring de `face_pipeline.py:7`.

---

### Estágio 1 — Fundação Arquitetural Sem Retrabalho (~2–3 semanas) — 🟡 EM ANDAMENTO (1A e 1B concluídos)
1. **Estágio 1A — Estado da Timeline por Instância com Fachada Compatível (~1,5–2 sem) — ✅ CONCLUÍDO (`5e05296`):**
   * Extrair classe/fábrica `TimelineSequenceState` (`cuts`, `tracks`, `transitions`, `markers`, `ghostTrack`, `fps/width/height`, `in/out`, `playheadFrame`, `history` próprio + invariante A/V).
   * Manter `TIMELINE_STATE`, `TIMELINE_HISTORY` e `STATE.activeTimelineCuts` como **fachada/proxy** para a sequência ativa — preserva os `44` autotestes e as `1.555` referências em `21` arquivos enquanto destrava **Task 25 (Abas)**, **edição da IA/MCP diretamente em timeline "clone" / múltiplas sequências fantasmas**, **Undo por turno de IA** e **motor headless**.
2. **Estágio 1B — Saneamento Crítico de Segurança & Banco (`DATA-01`, `SEC-01/02`, `NUV.43`) (~4–5 d) — ✅ CONCLUÍDO (`98656c7`, `5561def`, `d4957d1`, `4678990`, `6b17c9c`):**
   * Bind `127.0.0.1` por padrão + Bearer/token local para endpoints de sistema (ingest de path, install insightface, LLM/S3/settings) + montagem `/cache` respeitando `CONFIG.CACHE_DIR` (`server.py:167-169`) + ZIPs temporários fora de `EXPORTS_DIR`.
   * Streaming e limites contra DoS/zip-bomb em uploads (`media.py:768-794`, `projects.py:126-145, 173-188`, `narrative.py:577-594`).
   * Consertar `sync.py`: incluir todas as **30 tabelas**, corrigir leitura v2 de `sequence_json` (`:206-213`), usar `proxy_photo_{id}.webp`, parar de mutar hash (`_imp_`), copiar arquivos antes do commit mapeando novos IDs, e não engolir erros do Qdrant.
   * Adicionar `PRAGMA user_version` (`NUV.43`), `WAL + timeout` também em `db/operations.py:13-20`, remover `eval()` (`ffmpeg.py:62`) e caminhos `F:/` hardcoded (`audio_*.py`).
3. **Estágio 1C — Rede de Segurança de Render: `Frente B` (Nível 1) + `Frente D1` (E0–E3) (~1,5–2 sem) — 🟡 EM ANDAMENTO:**
   * ✅ **`Frente D1 E1–E2` concluída (`11efef5`):** pacote `src/navegador/` (`servidor.py` em `127.0.0.1` com token, Range e PUT atômico; `lancador.py` Playwright; `diagnostico.py` + rotas `/api/navegador/diagnostico` e `/api/navegador/testar`; `orfaos.py` + limpeza no `lifespan` e `TASK_MANAGER`; testes em `tests/test_navegador_*.py`).
   * ⏳ **Pendente para concluir o 1C:** `Frente D1 E3` (migrar `titulos.py` e `execucao.py:110` para `src/navegador/`, fechar navegador no cancelamento e eliminar thread daemon órfã) + `Frente B Nível 1` (`ffv1` + `pcm_s16le`, extração exata por índice, métricas numpy, cenários canônicos) + **Video Receipts** JSON por export (`Kinocut`).

---

### Estágio 2 — Prioridade 1: Ferramentas NLE Restantes & Fluxo de Áudio/Sequência
1. **Estágio 2A — Índice de Sequência (*Sequence Index*) (~2–3 d):**
   * Nova aba nativa em `tabPanels.js` / `dockModel.js`, alimentada somente leitura via fachada `TIMELINE_STATE` (clipes, offline, flash frames, transições, trilhas mutadas, marcadores), com salto para o corte e exportação CSV.
2. **Estágio 2B — Áudio Completo com Paridade (`Frente A` + `Task 19` + `Task 20` + `Task 21`) (~2,5–3 sem):**
   * **`Frente A` Etapa 1:** extrair `audioCadeia.js` de `player.js:5684+`.
   * **Task 19 (VU Meter `#program-audio-meter`):** acoplar `AnalyserNode` à saída agregada do `AudioContext` único em `audioCadeia.js` (zero conflito de `createMediaElementSource`).
   * **`Frente A` Etapas 2–7:** gate/compressor em `OfflineAudioContext` via `src/navegador/` + null tests na Frente B + reescrever `fidelidade.py:47-60`.
   * **Task 20 = `Frente F` (F0–F3):** `automacaoFaixa.js`/`automacao.py`, borracha de volume em `clip.keyframes.volume` + `Ctrl+Clique` na waveform + soma plana/`asetnsamples=256` no FFmpeg.
   * **Task 21 = `Frente F` (F4–F5):** auto-ducking determinístico por `transcript` / `silencedetect` gerando pontos editáveis + `keyframes_meta.volume` + nivelador em faixa separada.
   * **Offline Denoise:** acoplar trava impedindo auto-denoise em `trilha/ambiente/efeito/room_tone`; benchmark opcional A/B de **DeepFilterNet 3 ONNX** vs `dpdfnet` no `audio_denoise.py`.
3. **Estágio 2C — Paridade de Viewport & Multi-Track no Player (~3–4 d):**
   * Corrigir **Defeito #8** (`player.js:4131-4200` compor todas as pistas de vídeo visíveis) e decidir/corrigir **Defeito #6** (1 quadro do reverso).
   * Consolidar `computeContentRect()` (Fase 4) e garantia de `fit` no Crop (Fase 5) + alinhar `#adj-volume-slider`.
4. **Estágio 2D — Task 25: Múltiplas Timelines em Abas (~1 sem):**
   * Sobre o `TimelineSequenceState` do Estágio 1A: migrar `timeline` → múltiplas `sequence`s por projeto no SQLite, UI de abas de sequência, autosave isolado por aba, base para **timelines "clone" / múltiplas sequências fantasmas da IA** e invalidação/escopo de `renderCache.js` e `player.js`.
5. **Estágio 2E *(Opcional pós-decisões de design)* — Onda Lateral da Biblioteca:**
   * Implementar apenas após decidir com base no HTML interativo (`onda-lateral.html`, 20 perguntas), restrita à coluna barra esquerda de `panelRail.js` sem violar sobreposição.

---

### Estágio 3 — Prioridade 2: MCP Multi-Harness, Registro Único de Ferramentas & Sequência Fantasma
1. **Estágio 3A — Registro Único & Servidor MCP Multi-Harness (~1–1,5 sem):**
   * Criar **`src/tools/`** como registro único Pydantic compartilhado por **UI, Chat interno, REST e MCP** (eliminando imports privados de rotas dentro de `chat_agent.py:1088, 1276`).
   * Montar servidor **MCP Streamable HTTP (`/mcp`)** **dentro do processo FastAPI** (mantém instância única do Qdrant embutido sem conflito de lock).
   * Criar **`src/mcp/stdio_bridge.py`** (ponte leve encaminhando `stdio` ↔ `http://127.0.0.1:8000/mcp` com Bearer token) + modelos de configuração prontos para **Claude Code**, **Antigravity**, **Hermes Agent**, **Cursor** e **Gemini CLI**.
2. **Estágio 3B — Diretriz de Timeline "Clone", `D1–D6`, Bypass & UX de Revisão (`WeftCut` / `CutVoke` / `Frente H`) (~1–1,5 sem):**
   * **Diretriz definida pelo usuário:** a IA/MCP poderá editar **diretamente em uma timeline "clone"** isolada (com suporte a **múltiplas sequências fantasmas / clones** ou outro sistema de comparação/decisão na hora sobre `TimelineSequenceState` do Estágio 1A + Task 25), com validação do desenho fino de UX via **HTML explicativo** antes de iniciar os Estágios 1A/3B.
   * Corrigir `D1` (hit-test em todas as pistas para `INSERT`/`REPLACE`), `D2` (`suggestions_output`, conversão `in_s`→frames, **adicionar `SET_AV_OFFSET` e `ADD_EFFECT` ao gate `is_preview`**), `D3` (`populateRoughCutMarkers`), `D4` (`V2` padrão), `D5` (aviso claro offline), `D6` (`photo_id`/`type`/`kind` preservados fim a fim).
   * Expor `get_editor_state` (playhead/seleção/aba ou clone ativo), `preview_compare` (comparar clone vs original ou antes/depois), aba/lista **Changes** e **Undo atômico por turno** usando o `TIMELINE_HISTORY` do Estágio 1A.
   * Implementar **Frente H (`E1–E4`)**: revisão visual pelo agente sobre frame/título renderizado via `D1` (`modelo.py` + `exportVideo.js` sem `innerHTML`).
3. **Estágio 3C — Contratos entre Personas, Prompts & Testes de Contrato MCP (~1 sem):**
   * Aplicar contratos estruturados entre `TIMELINE_PERSONAS` (`diretora → montadora → sound_designer`, padrão **MASS**); remover `_recusa_auphonic` hardcoded quando não pertinente; implementar **Style Skills** (`FireRed`).
   * Migrar `E4` + montar suíte de contrato **MCP Inspector** / **`@vexyo/core`** estendendo `tests/test_f1_chat_agent.py`.

---

### Estágio 4 — Cor Técnica, Legendas, ASR Local & Confiabilidade de Entrega
1. **Estágio 4A — Cor Técnica Unificada (`Frente G` G0–G2c + `OCIO §0.3/§1.2`) (~8–9 d):**
   * Medição no Edge (`G0`) + `bt709`/`in_color_matrix=bt709`/`gbrp` no master (`G1a`) + BSF nos proxies (`G1b` = `OCIO §1.1`).
   * `src/media/capacidades.py` (`G2a`) + função única `src/color/transformacao.py::filtro_entrada` (`G2b–G2c` HDR→SDR no proxy e master).
   * Expor `color.raw_auto_bright` em `settings_registry.py` + `no_auto_bright` em `image_processing.py:13, 34` (as 1.092 fotos `.CR2`).
2. **Estágio 4B — Legendas Profissionais (`Frente C` E0–E9) (~1 sem):**
   * Bloco `legenda`, quebra 42×2 / 17 cps, anti-alucinação, reescrita de `subtitles_export.py` + rota `/export/{srt|vtt|ass}` (eliminando JS cliente em `panels.js:2631`), modo karaokê via `D1`.
3. **Estágio 4C — Parakeet Local + Alinhamento Forçado (`Frente E` + `fa-models`) (~1 sem):**
   * `nvidia_parakeet` TDT v3 em subprocesso isolado `sherpa_worker.py` (cortes ~60 s ±5 s + **gate PT-BR M1..M14** obrigatório).
   * Explorar `sherpa-onnx fa-models` para realinhamento fino de legendas editadas e ducking (`F4`); decidir destino único das tabelas `dialogue_utterance`/`dialogue_word` vs `transcript`.
4. **Estágio 4D — Verificação Pós-Render & Smart Cut (~4–5 d):**
   * Implementar checador **`proofcut`** pós-export (frames `nb_read_frames`, duração, LUFS/TP, conferência opcional por ASR).
   * Modo opcional de **smart cut** (`ffmpeg-skill`, re-encode só nas bordas do GOP) quando o trecho não tiver efeitos/velocidade/cor.

---

### Estágio 5 — Busca Híbrida, OCR Local, Conhecimento do Acervo & Visualizações Operacionais
1. **Estágio 5A — Saneamento de Busca, Prompts & Busca por Objetos (sem API paga) (~1–1,5 sem):**
   * Paginar `semantic.py:513` (`limit=100`); injetar `video.title` nos payloads Qdrant (`E2.D4`); reconstruir `capiau_images` local; pré-recorte de barras pretas estáticas (**`VideoSeek`**) antes do CLIP/dHash; corrigir `rag.py` (`LIKE` → tokens/entidades); resolver/limpar `photo_vision` e `triage_batch_title` no `PROMPT_REGISTRY`.
   * Entregar chips de facetas (`E2.D3-UI`), parser determinístico (`E4.A1`) + `intent_router.py` (`PROPOSTA_BUSCA_OBJETOS`) + `finalidade`/`vocabulario` estrutural em `pipeline.py` (`proximos_chats/03..04`).
2. **Estágio 5B — OCR Local (`PP-OCRv6`) + `visual_memory` Cacheado (~1 sem):**
   * Instalar `rapidocr_onnxruntime` (CPU, Apache-2.0): detector `tiny` + reconhecedor `small` + `dHash` + varredura de claquete (2–3 fps nos 5s iniciais/finais) gravados **primeiro no SQLite** (`video_keyframe`/`video_ocr`) e só depois no Qdrant.
   * Alimentar vínculo automático `scene_id` (`Chat 05`) + compilador cacheado por hash de estado (`visual_memory.json`/`visual_memory.md`) para leitura direta pelo MCP.
3. **Estágio 5C — Capitularização Multimodal & Cobertura de Roteiro (~1 sem):**
   * Criar tabela dedicada `media_chapter` (silêncio + speaker + queda MiniLM + salto visual CLIP + TF-IDF local + título curto LLM) com persistência de markers, export OTIO e `PySceneDetect save-chapters` / FFmetadata.
   * Criar tabela **`scene_media`** (`P3`) + chaves estáveis de `scene` + relatório de cobertura.
4. **Estágio 5D — 5 Visualizações Operacionais & Knowledge/Evidence Graph (~1,5–2 sem):**
   * *Sub-onda imediata:* **Swimlane Temporal**, **Treemap Categoria × Confiança**, **Mapa 2D CLIP (`PCA+t-SNE`)** usando `/api/media/similar-batch` (`media.py:503`) com cache invalidado em `/api/search/reindex`.
   * *Sub-onda pós-`scene_media` + vínculo personagem↔pessoa:* **Matriz Cena × Material** e **Storyline / Arc Diagram**.
   * Migrar tabela `relation` (`schema.py:363-373`) removendo `CHECK` restritivo apenas para destravar **Evidence/Knowledge Graph** (e sync curado opcional com Obsidian).
5. **Estágio 5E — Embeddings Int8, ArcFace Real & Separação de Falantes (quando priorizar):**
   * Testar **`jinqiu193/trace` (`EmbeddingGemma 2 int8 ONNX`)** como evolução realista de `PLANO_EMBEDDINGGEMMA2.md`.
   * Migrar de fato `pipeline.py`/`face_engine.py`/`local_backend.py` de SFace 128-d (e fallback Sobel) para **SCRFD + ArcFace 512-d** real (`FaceService` / `faces.py`).
   * Avaliar **`VoxLock`** para entrevistas com sobreposição severa de vozes.

---

### Estágio 6 — Qualidade de Decisão IA, Cor Criativa, HTML WAAPI & Rodada Casa (`E1.T9`)
1. **Estágio 6A — Grafo de Decisões Calibradas + `talho-bench` + Otimização de Prompts (`MASS`):**
   * Estender `system1_decisao` para granulação por *beat* (`segment_id` / janela temporal) → validar portões determinísticos e modelos locais no **`talho-bench`** antes de habilitar fan-out / HMM + Viterbi (`RoughCut`).
   * Laço offline de otimização no `PROMPT_REGISTRY` com feedback humano de triagem + torneio **Bradley–Terry** para nomeação de temas/títulos.
2. **Estágio 6B — Cor Criativa (`Frente G` G3–G6 + `OCIO §2.1`) + Facetas de Cor (`§1.4/§1.5/§1.7`):**
   * `.cube` + LUT técnica no proxy (`G3`) → `sugestao.py` analítica P10/P90 (`G4`) → curvas PCHIP `lut1d`+SVG + `temperature`/`tint` (`G5`) → `ocio_manager.py` sob demanda gerando `.cube` ACES para `G3a` → WebGL2 após gate (`G6`) + `lighting.py`/`continuidade.py`/`otio` de cor.
3. **Estágio 6C — Composições HTML WAAPI (`Frente D2`), Rampas de Áudio (`F6–F8`), Regressão Nível 2 & Dock F6:**
   * Composições animadas WAAPI (sem GSAP), detecção de batidas numpy + rampa `rate`, comparação Program DOM × Export (`B` Nível 2), Window Management API + FLIP + teclado/a11y (`HANDOFF_JANELAS_DRAG_DOCK` F6).
4. **Estágio 6D — Execução Pós-`E1.T9` (quando tiver Banco de Casa + APIs):**
   * Conciliar banco local vs casa (`E1.T9`), concluir triagem ~506 vídeos + `E1.T10`, calibrar PANNs e `visao_calibrar`, testes pagos `DINO-X`/`Jev`, integrar `08_plano_sequencia` ao banco e preencher `06_gabaritos_avaliacao.md`.

---

### Estágio 7 — Nuvem Completa, Aprendizado Editorial, GPU Híbrida & Satélites (Sob Demanda)
1. **Estágio 7A — `PLANO_NUVEM.md` (`NUV.2..NUV.63`):** vault AES-256-GCM (DPAPI/Keychain) para chaves de API, `s3_service.py` para Cloudflare R2 (presigned URLs/ETags/sem bloqueio `"originals"`), backup incremental criptografado + restore, worker resiliente via WebSocket.
2. **Estágio 7B — `Editorial DNA` (`src/patterns/`):** registro de *deltas* entre sugestão da IA e corte final humano com isolamento `Projeto → Estilo → Editor` e evolução em 5 níveis até Rough Cut adaptativo.
3. **Estágio 7C — Micro-Renders Híbridos, GPU na Nuvem (BYOK + UEG) & Blender MCP:** recorte GOP exato da fonte comprimida (`SHA-256`), probe de 10 MB + microbenchmark 8–16 frames, UI Topaz-like + Cloudflare R2 (egress zero), worker container BYOK (RunPod/Modal/Vast) ou cluster UEG; catálogo em duas vias (permissiva vs NC isolada com aviso); `blender-mcp` para geração de cena em container efêmero; trava ética *Archival Producers Alliance*.
4. **Estágio 7D — Ecossistema Satélite:** busca multi-fonte B-roll (`yt-dlp`, Internet Archive, Pexels, Loki + anonimização), proxies Wi-Fi em set, roteamento local UEG (`Lumi-4B` / `needle2`), ponte `DaVinci Resolve Free`, integração `MAM CriaLab` / `CapIAu-play` / `Communicator Set`.

---

## 4. Lista Resumida Mestre (Mapa de Ligação com Todos os Planos Detalhados)

| Estágio | Bloco / Frente Resumida | Status Atual (`main` @ `11efef5`) | Planos Detalhados de Origem | Nota Obrigatória ao Refazer o Plano do Bloco |
|---|---|---|---|---|
| **0A** | Bug alças manual, botão Seq Settings, Crop ≤90%, Dock micro-fixes, Color Labels (**Task 22**) *(sem `--space-scale`)* | ✅ Concluído (`ae252e0`, `a59fc02`) | [`09_quick_wins_estagio_0.md`](../agentes/proximos_chats/09_quick_wins_estagio_0.md) · [`PLANO_VIEWPORT_TRANSFORM_CROP.md`](./PLANO_VIEWPORT_TRANSFORM_CROP.md) · [`HANDOFF_JANELAS_DRAG_DOCK.md`](../agentes/HANDOFF_JANELAS_DRAG_DOCK.md) · [`PLANO_SUITE_NLE_CLASSICO.md`](./PLANO_SUITE_NLE_CLASSICO.md) | Tasks 0–18, 22, 23 e 24 prontas; `--space-scale` adiado c/ HTML em `explicativos/` |
| **0B** | EQ/Mono (`Frente A E0`), −1 frame, `video_dip_white`, `gblur` clipe, OTIO `speed` *(sem `"bezier"`)* | ✅ Concluído (`9972298`, `ead9c01`, `4b5c023`, `dbfddf3`, `945b843`) | [`09_quick_wins_estagio_0.md`](../agentes/proximos_chats/09_quick_wins_estagio_0.md) · [`A_audio_paridade.md`](../plano_hyperframes/A_audio_paridade.md) · [`plano_hyperframes/README.md`](../plano_hyperframes/README.md) · [`F_audio_avancado_rampas.md`](../plano_hyperframes/F_audio_avancado_rampas.md) | Decisão `"bezier"` vs `"s_curve"` com HTML em `explicativos/` antes da Frente F / Nível 1 |
| **0C** | CORS, `--reload` fora do padrão, XSS `chat.js`/`timelineInteraction.js`, `face.embedding` no schema, `proximos_chats/02`, `requirements.txt`, docs divergentes | ✅ Concluído (`44077f0`, `1c4848a`, `8cc01fa`, `2e57224`, `a1dc7b2`) | [`09_quick_wins_estagio_0.md`](../agentes/proximos_chats/09_quick_wins_estagio_0.md) · [`plano-de-refatoracao-capiau-talho.md`](../plano-de-refatoracao-capiau-talho.md) · [`02_limpeza_configuracoes_dispositivo.md`](../agentes/proximos_chats/02_limpeza_configuracoes_dispositivo.md) · [`AUDITORIA_DOCUMENTACAO_2026-10-29.md`](../dev/AUDITORIA_DOCUMENTACAO_2026-10-29.md) | `assemblyai_key`/`deepgram_key`/`auphonic_key` preservadas (têm leitores reais) |
| **1A** | Extrair `TimelineSequenceState` por instância com fachada compatível (`TIMELINE_STATE` + suporte a clones/fantasmas) | ✅ Concluído (`5e05296`) | [`PLANO_SUITE_NLE_CLASSICO.md`](./PLANO_SUITE_NLE_CLASSICO.md) · [`PROPOSTA_SEQUENCIA_FANTASMA_IA.md`](../propostas/PROPOSTA_SEQUENCIA_FANTASMA_IA.md) | Fachada `Proxy` + `SequenceManager` mantêm autotestes verdes para Task 25 e clones da IA |
| **1B** | Saneamento `SEC-01/02`, `DATA-01/02` (`sync.py` 30 tabelas + v2 + `proxy_photo_`), `NUV.43` (`user_version`), `TEST-01` | ✅ Concluído (`98656c7`, `5561def`, `d4957d1`, `4678990`, `6b17c9c`) | [`plano-de-refatoracao-capiau-talho.md`](../plano-de-refatoracao-capiau-talho.md) · [`PLANO_NUVEM.md`](./PLANO_NUVEM.md) | Token Bearer local em `security.py`; gerenciador real em `src/core/tasks.py` (`TASK_MANAGER`) |
| **1C** | Regressão Nível 1 (`ffv1`, métricas numpy, Video Receipts) + Navegador comum `127.0.0.1` (`D1` E0–E3) | ✅ Concluído (`11efef5` + finalização `src/navegador/`, `recibo.py`, `tests/render_regressao/`) | [`B_regressao_render.md`](../plano_hyperframes/B_regressao_render.md) · [`D1_navegador.md`](../plano_hyperframes/D1_navegador.md) · [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§10) · [`11_estagio_1c_regressao_render_navegador.md`](../agentes/proximos_chats/11_estagio_1c_regressao_render_navegador.md) | `src/navegador/` (`127.0.0.1`) ativo em `titulos.py`/`execucao.py`/`fidelidade.py`; `recibo.py` e suíte `tests/render_regressao/` (18 cenários Nível 1) ativos |
| **2A** | Índice de Sequência (*Sequence Index*, tabela + filtro + salto + CSV) | Novo (0% código) | [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§3) | Ler somente via fachada `TIMELINE_STATE` e registrar como aba nativa de `tabPanels.js` |
| **2B** | Paridade WebAudio (`audioCadeia.js`), **Task 19** (VU Meter), **Task 20** (Borracha = `F0–F3`), **Task 21** (Ducking = `F4–F5`), trava + teste `DeepFilterNet 3` | Parcial (denoise/categorias ok; A/F/19/20/21 não) | [`A_audio_paridade.md`](../plano_hyperframes/A_audio_paridade.md) · [`F_audio_avancado_rampas.md`](../plano_hyperframes/F_audio_avancado_rampas.md) · [`PLANO_SUITE_NLE_CLASSICO.md`](./PLANO_SUITE_NLE_CLASSICO.md) · [`PLANO_AUDIO_CATEGORIAS.md`](./PLANO_AUDIO_CATEGORIAS.md) · [`AUPHONIC_AUDIO_RESTORATION_GUIDE.md`](../dev/AUPHONIC_AUDIO_RESTORATION_GUIDE.md) | **Seguir `Frente F` no lugar das specs antigas de Task 20/21**, e fazer **Task 19 após `audioCadeia.js`** |
| **2C** | 3+ pistas no Program (Defeito #8), reverso 1 frame (#6), `computeContentRect()`, `fit` crop | Abertos / Parciais | [`plano_hyperframes/README.md`](../plano_hyperframes/README.md) · [`PLANO_VIEWPORT_TRANSFORM_CROP.md`](./PLANO_VIEWPORT_TRANSFORM_CROP.md) | Reverso no player (`player.js:4539`) diverge 1 quadro de `modelo.py:172` |
| **2D** | **Task 25**: Múltiplas Timelines em Abas (`sequence` por projeto + clones da IA) | Ausente (depende de 1A) | [`PLANO_SUITE_NLE_CLASSICO.md`](./PLANO_SUITE_NLE_CLASSICO.md) | Exige `TimelineSequenceState` (1A) + escopo por `sequence_id` no `renderCache.js` |
| **2E** | *Opcional:* Onda Lateral da Biblioteca (`onda-lateral.html`) | Mockup pronto / 20 perguntas (HTML futuro) | [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§3) | Restringir à barra esquerda sem quebrar `panelRail.js` nem sobrepor painéis |
| **3A** | Registro único `src/tools/` + MCP Streamable HTTP `/mcp` no FastAPI + `stdio_bridge` para 5 harnesses | `src/mcp/` não existe | [`PLANO_IMPLEMENTACAO.md`](./PLANO_IMPLEMENTACAO.md) (`E4`) · [`PROPOSTA_SEQUENCIA_FANTASMA_IA.md`](../propostas/PROPOSTA_SEQUENCIA_FANTASMA_IA.md) · [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§10) | Obrigatório rodar `/mcp` dentro do FastAPI para evitar erro de lock do Qdrant embutido |
| **3B** | **Edição IA em timeline "clone" / múltiplas fantasmas**, corrigir `D1–D6` + bypass `SET_AV_OFFSET`/`ADD_EFFECT`, `get_editor_state`, `preview_compare`, Changes + Undo, **Frente H** | 6/6 abertos + bypass | [`PROPOSTA_SEQUENCIA_FANTASMA_IA.md`](../propostas/PROPOSTA_SEQUENCIA_FANTASMA_IA.md) · [`H_revisao_agente.md`](../plano_hyperframes/H_revisao_agente.md) · [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§10) | **Diretriz:** IA edita direto em timeline "clone" (UX fina via HTML explicativo); fechar bypass em `chat_agent.py:2275` |
| **3C** | Contratos `TIMELINE_PERSONAS` (MASS), `Style Skills` (`FireRed`), `E4`, contratos **MCP Inspector / `@vexyo/core`** | Parcial / Não iniciado | [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§1, §10) · [`PLANO_IMPLEMENTACAO.md`](./PLANO_IMPLEMENTACAO.md) | Estender `tests/test_f1_chat_agent.py` com golden fixtures |
| **4A** | Cor técnica unificada (`G0–G2c` + `OCIO §0.3/§1.2` para CR2) | `G` 0%; `OCIO` só Fase 0 | [`G_cor.md`](../plano_hyperframes/G_cor.md) · [`PLANO_COR_OCIO.md`](./PLANO_COR_OCIO.md) | Adotar `filtro_entrada` da Frente G direto no proxy (descartar segundo proxy de `cadeia.py`) |
| **4B** | Legendas completas (`Frente C` E0–E9, `/export/{srt,vtt,ass}`, remover JS morto) | `subtitles_export.py` órfão | [`C_legendas.md`](../plano_hyperframes/C_legendas.md) | Substitui o blob client-side de `panels.js:2631-2679` |
| **4C** | `nvidia_parakeet` em `sherpa_worker.py` (gate M1..M14) + `fa-models` (forced alignment) | 0% | [`E_parakeet.md`](../plano_hyperframes/E_parakeet.md) · [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§10) | Unificar ou usar `dialogue_utterance`/`dialogue_word` que hoje não recebem gravação |
| **4D** | Checador pós-render **`proofcut`** + **smart cut** GOP (`ffmpeg-skill`) | Novo | [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§10) | Smart cut restrito a cortes diretos sem efeitos/cor/velocidade |
| **5A** | Saneamento Qdrant (`video.title`, `limit=100`, `capiau_images`), `VideoSeek` pré-recorte, fix `rag.py`, `intent_router` + `E2.D3-UI` + `03/04` | Pendente | [`ORDEM_DAS_ANALISES.md`](./ORDEM_DAS_ANALISES.md) · [`PLANO_IMPLEMENTACAO.md`](./PLANO_IMPLEMENTACAO.md) · [`PROPOSTA_BUSCA_OBJETOS.md`](../propostas/PROPOSTA_BUSCA_OBJETOS.md) · [`03_checagem_tecnica_B.md`](../agentes/proximos_chats/03_checagem_tecnica_B.md) · [`04_busca_objeto_A_D.md`](../agentes/proximos_chats/04_busca_objeto_A_D.md) | Executa offline sem `E1.T9`; resolver também os 2 prompts mortos do `PROMPT_REGISTRY` |
| **5B** | OCR local `PP-OCRv6` (`RapidOCR 3.9` + claquete 2–3 fps) → vínculo cena + `visual_memory.json/.md` | Novo (`.venv` já tem `onnxruntime`) | [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§4) · [`05_continuidade_C.md`](../agentes/proximos_chats/05_continuidade_C.md) | Persistir em SQLite antes do Qdrant; invalidar `visual_memory` por hash de estado |
| **5C** | Capitularização multimodal (`media_chapter` + markers/OTIO/`save-chapters`) + `scene_media` (`P3`) + chaves estáveis de `scene` | Parcial (P2 feito; P3/capítulos não) | [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§8) · [`PLANO_IMPLEMENTACAO.md`](./PLANO_IMPLEMENTACAO.md) (`P3`) · [`08_plano_sequencia.md`](../agentes/proximos_chats/08_plano_sequencia.md) | `media_segment.kind` bloqueia `'chapter'` (criar tabela própria); `replace_scenes_for_doc` precisa chave estável |
| **5D** | **5 Visualizações Operacionais** (Swimlane, Treemap, PCA+t-SNE → Matriz, Storyline) + migração `relation` p/ Knowledge Graph | Subsuportado por `scene_media` e `CHECK` em `relation` | [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§7) | Rota existente é `/api/media/similar-batch` (`media.py:503`), não `batch-similar`; migrar `CHECK` da `relation` para Evidence Graph |
| **5E** | `EmbeddingGemma 2 int8 ONNX` (`trace`), migração genuína SCRFD + ArcFace 512-d, `VoxLock` | 0% (`LocalBackend` usa Sobel!) | [`PLANO_EMBEDDINGGEMMA2.md`](./PLANO_EMBEDDINGGEMMA2.md) · [`PLANO_MODERNIZACAO_ANALISES_IA_2026.md`](../Pesquisas/PLANO_MODERNIZACAO_ANALISES_IA_2026.md) · [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§10) | Corrigir docs enganosos do plano de modernização e tirar o fallback silencioso de `local_backend.py` |
| **6A** | Grafo de Decisões por beat (`system1_decisao`) + **`talho-bench`** + HMM/Viterbi + otimização prompts/Bradley–Terry (`MASS`) | Piloto `system1_service` existe; sem granularidade por beat | [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§1, §5) · [`REVISAO_CATEGORIAS.md`](./REVISAO_CATEGORIAS.md) | Calibrar limiares no `talho-bench` antes de automatizar qualquer descarte |
| **6B** | Cor Criativa (`G3–G6` + `OCIO §2.1` + facetas `§1.4/§1.5/§1.7` + `§3.2`) | 0% (wiki/11 já avisa) | [`G_cor.md`](../plano_hyperframes/G_cor.md) · [`PLANO_COR_OCIO.md`](./PLANO_COR_OCIO.md) | `sugestao.py` (G4) substitui `auto_grade.py`; atualizar `wiki/11` apenas ao concluir G |
| **6C** | Composições HTML WAAPI (`Frente D2`), Rampas (`F6–F8`), Regressão Nível 2 (`Frente B`), Drag & Dock `F6`, fontes Canvas 2D | 0% | [`D2_composicoes_html.md`](../plano_hyperframes/D2_composicoes_html.md) · [`F_audio_avancado_rampas.md`](../plano_hyperframes/F_audio_avancado_rampas.md) · [`B_regressao_render.md`](../plano_hyperframes/B_regressao_render.md) · [`HANDOFF_JANELAS_DRAG_DOCK.md`](../agentes/HANDOFF_JANELAS_DRAG_DOCK.md) · [`PLANO_TEMA_NEUTRO.md`](./PLANO_TEMA_NEUTRO.md) | Não usar GSAP (`GPL/licença`); usar WAAPI nativa |
| **6D** | Conciliar banco de casa (`E1.T9`), ~506 vídeos + `E1.T10`, calibração PANNs/`visao`, `DINO-X`/`Jev`, gabaritos humanos (`06`) | Bloqueado por `E1.T9` / API | [`PLANO_IMPLEMENTACAO.md`](./PLANO_IMPLEMENTACAO.md) · [`REVISAO_CATEGORIAS.md`](./REVISAO_CATEGORIAS.md) · [`06_gabaritos_avaliacao.md`](../agentes/proximos_chats/06_gabaritos_avaliacao.md) · [`07_pendencias_externas.md`](../agentes/proximos_chats/07_pendencias_externas.md) | Fazer após retomar o banco principal e definir orçamento de API |
| **7A–7D** | `PLANO_NUVEM` (`NUV.2..63`), `Editorial DNA`, Micro-Renders Híbridos + GPU BYOK/UEG + `blender-mcp`, Satélites externos | `NUV.1` só; resto 0% / Futuro | [`PLANO_NUVEM.md`](./PLANO_NUVEM.md) · [`NOVOS_PLANOS_IAS_2026-11.md`](./NOVOS_PLANOS_IAS_2026-11.md) (§2, §6, §9, §11) | Seguir via dois catálogos (permissivo × NC isolado) e regras Archival Producers Alliance |

---

## 5. Diretriz Definida & Decisões Adiadas (Com HTML Explicativo)

### Diretriz já definida (Estágios 1A, 2D e 3B)
* **Edição da IA / MCP em Timeline "Clone" (Múltiplas Sequências Fantasmas):** A IA/MCP **poderá editar diretamente em uma timeline "clone"** isolada da sequência ativa, com suporte a **múltiplas sequências fantasmas / clones** (ou outro mecanismo de decisão na hora, a detalhar com **HTML explicativo** antes de iniciar os Estágios 1A/3B).

### Decisões adiadas (nenhuma bloqueia o Estágio 0 — decidir depois com HTML explicativo dedicado)
> **Central de HTMLs explicativos gerada em `d2a3437`:** [`docs/planos/explicativos/index.html`](./explicativos/index.html) ([`timeline-clone-ia.html`](./explicativos/timeline-clone-ia.html), [`curvas-bezier-vs-s-curve.html`](./explicativos/curvas-bezier-vs-s-curve.html), [`espacamento-space-scale.html`](./explicativos/espacamento-space-scale.html), [`politica-reverso.html`](./explicativos/politica-reverso.html), [`ponte-banco-local-casa.html`](./explicativos/ponte-banco-local-casa.html)).

1. **Curva `"bezier"` vs `"s_curve"` (antes da Frente F / Regressão Nível 1):** usar [`curvas-bezier-vs-s-curve.html`](./explicativos/curvas-bezier-vs-s-curve.html) para decidir se `"bezier"` entra em `fade.py`/`timelineState.js` ou se os testes padronizam em `"s_curve"`.
2. **Controle de espaçamento `--space-scale` (antes de retomar tema):** usar [`espacamento-space-scale.html`](./explicativos/espacamento-space-scale.html) para decidir entre expor na janela Aparência ou manter fixo como na Rodada 3b.
3. **Política do Reverso (Estágio 2C):** usar [`politica-reverso.html`](./explicativos/politica-reverso.html) para decidir entre alinhar o Player ao Export (`out - 1` frame, padrão `modelo.py`) ou o Export ao Player.
4. **Onda Lateral da Biblioteca (Estágio 2E):** revisar o HTML interativo já existente (`onda-lateral.html`, 20 perguntas) para decidir se entra após a Task 25 ou fica arquivada.
5. **Ponte Banco Local × Banco de Casa (`E1.T9`, Estágio 6D):** usar [`ponte-banco-local-casa.html`](./explicativos/ponte-banco-local-casa.html) comparando os fluxos (`sync.py` corrigido vs dump/merge SQLite) antes de executar a reconciliação.
