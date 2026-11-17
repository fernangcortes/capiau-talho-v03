# Próximo Chat — Quick Wins (Estágio 0: Blocos 0A, 0B e 0C)

> **Contexto:** Roteiro operacional derivado de [`GRANDE_PLANO_UNIFICADO_2026-11.md`](../../planos/GRANDE_PLANO_UNIFICADO_2026-11.md) sobre `main` (`7e82b92`).
> **Escopo:** Todos os itens abaixo estão **100% livres de decisões de design em aberto** (`"bezier"` vs `"s_curve"` e `--space-scale` foram retirados para decisão posterior via HTML explicativo).
> **Regra obrigatória:** Garantir paridade Player × Export FFmpeg em cada mudança e preservar testes verdes após cada bloco.

---

## Bloco 0A — UI, NLE, Transform, Drag & Dock e Task 22 (~1–1,5 dia)

1. **Bug ativo do arraste das alças no modo manual (`src/ui/js/player.js:6820-6823`):**
   * *Problema:* `onMouseMove` chama `interaction.refreshClipInspector()`, emitindo `timelineSelectionChanged` (`timelineInteraction.js:6272`), o que zera `manualTransformClipId` (`player.js:2877-2882`) e esconde o overlay no primeiro movimento do mouse.
   * *Ação:* Parar de chamar `refreshClipInspector()` durante o `mousemove` (atualizar sliders/inputs in-place ou apenas no `mouseup` sem reemitir `timelineSelectionChanged`).
   * *Verificação:* `node tests/autoteste_transform_overlay_manual_ctrl.mjs`.
2. **Botão Configurações da Sequência com Inspetor em barra (`src/ui/js/main.js:3308`):**
   * *Problema:* `#btn-seq-settings-program` chama `expandSidebar("inspector")`, mas o Inspetor inicia em `"barra"` (`panelRail.js:61`).
   * *Ação:* Trocar por `window.expandInspectorPanel()`.
3. **Trava par-a-par de Crop ≤ 90% (`src/ui/js/timelineInteraction.js:6503-6511, 8640-8664, 11242-11288`):**
   * *Problema:* Sliders permitem `0..100` sem validar `left + right <= 90` nem `top + bottom <= 90` (com 100%, o clipe some no player enquanto `geometria.py:153-154` deixa fresta de 2 px).
   * *Ação:* Aplicar clamp par-a-par nos handlers/inputs de Crop em `timelineInteraction.js`.
4. **Higiene de Viewport & Histórico (`src/ui/js/player.js`, `src/ui/js/timelineState.js`):**
   * Chamar `syncProgramViewport()` no início de `syncVideoToPlayhead()` (`player.js`).
   * Incluir `fps`, `width` e `height` em `TIMELINE_HISTORY._capture()` / `_restore()` (`timelineState.js:9131-9243`).
   * Extrair helper único para o bloco triplicado de auto-configuração do 1º clipe (`timelineState.js:4559, 4988, 5329`).
5. **Pendências curtas de Drag & Dock e HTML:**
   * `src/ui/js/workspaceManager.js:4133-4174` (`DOCK.15`): trocar `#toggle-left`/`#toggle-right.click()` por `expandLeftPanel()`/`expandRightPanel()`.
   * `src/ui/js/workspaceManager.js:3119-3125` (`DOCK.4`): ignorar colunas com `display === "none"` em `reinitSplitters`.
   * `src/ui/js/workspaceManager.js:176-184, 1426, 1665` + `src/ui/index.html:97` (`DOCK.5`, `DOCK.9`): adicionar metadados de `tabpanel-*` em `columnMetadata` e remover `<select id="select-timeline-position">` oculto.
   * `src/ui/panel.html:18` e `src/ui/panel-group.html:12`: atualizar `styles.css?v=90` → `styles.css?v=94`.
   * `src/ui/js/main.js:3161-3172` (`DOCK.31`): preservar scroll infinito quando a Busca estiver destacada.
   * Título dinâmico de `sidebar-right` quando Falas estiver fora (`DOCK.33`) + ajustes de `min-height` `.workspace` / `max-height` `.dock-band` (`src/ui/styles.css:15354, 15380`, `DOCK.3`).
   * *Verificação:* `node tests/autoteste_dock_model.mjs`, `node tests/autoteste_dock_tabs.mjs`, `node tests/autoteste_dock_group.mjs`.
6. **Task 22 — Color Labels (`docs/planos/PLANO_SUITE_NLE_CLASSICO.md`):**
   * Adicionar campo `colorLabel` no clipe, paleta de 8 cores no menu de contexto (`timelineInteraction.js`), pintura da faixa/chip no `timelineRenderer.js`, persistência e cobertura em `tests/autoteste_color_labels.mjs`.

---

## Bloco 0B — Render & Paridade FFmpeg — Fila 0 (~1,5 dia)

1. **EQ Q-factor + Mono −3 dB (`Frente A Etapa 0`, `src/export/video_render/grafo_audio.py:407-413, 884`):**
   * Ajustar `highpass` para `width=1.122018` e shelves `bass`/`treble` para `width=0.5`.
   * Antes de `aformat=sample_fmts=fltp:channel_layouts=stereo` (`:884`), compensar fontes mono com `pan=stereo|c0=c0|c1=c0`.
2. **Export 1 quadro mais curto (Defeito #1, `src/export/video_render/comando.py:717`):**
   * Corrigir corte de 1 frame causado pelo posicionamento/parametrização de `fps={_fmt(fps_saida)}` pós-`overlay` antes de `-t` (`:737`) e validar contagem exata de frames com `ffprobe -count_frames`.
3. **Bug novo — `video_dip_white` no export (`src/export/video_render/grafo_video.py:536-658`):**
   * Criar ramo dedicado para `video_dip_white` gerando flash branco puro (`1 - 2*|t - 0.5|`), alinhado ao player (`src/ui/js/player.js:71-77, 4256-4271`), em vez de cair no crossfade comum.
   * Adicionar teste em `tests/test_render_grafo_video_transicao.py`.
4. **Desfoque de clipe vs título (Defeito #16, `src/export/video_render/cor.py:229`):**
   * Alinhar `gblur=sigma=...` de clipe ao padrão `FATOR_SIGMA_DESFOQUE = 1.05` e `PASSOS_GBLUR = 4` (`src/export/video_render/titulos.py:65-66`).
5. **OTIO velocidade constante (Defeito #10 parcial, `src/export/otio_export.py:230-299`):**
   * Dividir a duração na timeline por `speed` e anexar `otio.schema.LinearTimeWarp` em clipes com velocidade constante.

---

## Bloco 0C — Higiene Operacional, Segurança Básica & Schema (~1–2 dias)

1. **CORS restrito à origem local (`SEC-01`, `src/api/server.py:66-72`):**
   * Substituir `allow_origins=["*"]` com `allow_credentials=True` por origens locais explícitas (`http://127.0.0.1:<porta>`, `http://localhost:<porta>`).
2. **Remover `--reload` do modo normal:**
   * `scripts/launch_capiau.ps1:83` e `scripts/run-local.ps1:35` (isolar sob flag `-Dev`), além de `Dockerfile:60` e `docker-compose.yml:8-9, 23` (evita matar jobs/render em memória e prepara bind seguro).
3. **Sanitização XSS (`SEC-03`):**
   * Aplicar `escapeHtml` antes de `innerHTML` em `src/ui/js/chat.js:406-408, 732-775` (`renderMarkdown`), `src/ui/js/timelineInteraction.js:13608-13619, 13911-13913, 13951` e escapar saída em `src/services/timeline_ai.py:301`.
4. **Coluna `face.embedding` no schema (`src/db/schema.py:108-127`):**
   * Incluir `embedding BLOB` em `CREATE TABLE face` para compatibilidade com `src/vision/face_engine.py:237`.
5. **Limpeza de configurações mortas e dependências (`02_limpeza_configuracoes_dispositivo.md` + Defeitos #12, #13, #14):**
   * Remover chaves sem consumidor em `src/services/settings_registry.py`: `object.execution_mode` (`:282`), `object.auto_crop` (`:290`), `object.link_script_props` (`:297`), `api.anthropic_key` (`:78`), `api.deepseek_key` (`:85`), `api.nvidia_nim_key` (`:99`), `api.local_vlm_endpoint` (`:106`), `faces.recognition_confidence` (`:1002`). **(Preservar `assemblyai_key`, `deepgram_key`, `auphonic_key`, `triage.jev_via`, `triage.feedback_examples` e `hardware.opencv_opencl`, que possuem leitores reais.)**
   * Conectar `hardware.ai_device` nos locais hardcoded `"cpu"` (`semantic.py:90`, `image_semantic.py:69,77`, `shot_scale.py:89`, `motores.py:285`, `detectores.py:186`, `system1_service.py:241`).
   * Corrigir descrição falsa de fallback AssemblyAI (`src/services/settings_registry.py:170`), remover referência a `requirements-opcional.txt` (`src/services/modelos_locais.py:224`), checar executável real Edge/Chrome em `titulos.playwright_instalado()` (`src/export/video_render/titulos.py:76-78`), e declarar `pypdf`, `sherpa-onnx`, `soundfile`, `pytest` e `syrupy` em `requirements.txt`.
6. **Sincronia documental pós-PR #6:**
   * Ajustar `.gitignore:53-55`, `wiki/02.-Instalacao-e-Configuracao.md`, `wiki/16.-Solucao-de-Problemas-e-FAQ.md` e a docstring de `src/vision/face_pipeline.py:7`.
   * *Verificação:* `python -m pytest tests/test_docs_sincronizadas.py` e suíte `tests/test_render_*.py`.
