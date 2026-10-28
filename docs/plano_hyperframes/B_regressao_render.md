# Frente B — Regressão do render por imagem e som, e teste de paridade player × export

> **Resumo.** Entrega duas camadas de teste que hoje não existem. **Nível 1** (`tests/render_regressao/`): renderiza cenários pequenos (320×180, 24 fps)
> pelo `montar_comando` de produção, troca só o codec por um intermediário sem perdas e confere imagem e som contra oráculos (nº do quadro em código de barras,
> fórmulas W3C/CSS, curvas de áudio), testes metamórficos (bypass = ausência) e referências aprovadas de ≈ 1 MB. **Nível 2:** abre o Program num Edge/Chrome
> headless e compara o quadro N do monitor com o quadro N do export. **Valor:** rede de segurança para toda frente que muda pixels ou amostras; a medição já achou
> 6 desvios candidatos (2.6), entre eles *um quadro a menos* em 4 de 7 casos e *HD sem etiqueta de cor*. **Esforço: ~15 dias úteis** (Nível 1 ≈ 8,5; Nível 2 ≈ 7),
> corte mínimo de ≈ 5 dias, correções à parte. **Dependências:** nenhuma no Nível 1; a paridade de áudio do Nível 2 espera a frente de áudio pelo navegador.
> **Risco principal:** ruído legítimo Chromium × swscale (crominância, matriz) e *seek* instável no headless. **Decisão mais importante:** versionar fontes e PNG
> pequenos no Git com aprovação explícita por CLI, em vez de Docker + Git LFS como o HyperFrames.

Marcas: **[lido]** conferido no código · **[inferência]** dedução minha · **[a medir]** precisa de teste prático ·
**[web]** fonte externa · **[medido]** medi eu neste sandbox (Linux, ffmpeg 6.1.1, numpy 2.5, sem navegador; **não** é a máquina
do Fernando, cujo ffmpeg é o 7.1.4 Jellyfin pelo comentário de `execucao.py:28` [inferência: "nesta máquina"]). Caminhos sem prefixo são do Talho; `HF:` é o HyperFrames.
Tudo o que é decisivo e foi [medido] aqui está repetido como [a medir] para a primeira execução na máquina do Fernando.
Nomes que eu proponho levam "(novo)".

---

## 1. Objetivo e valor para o Fernando

Hoje a promessa "o arquivo sai igual à tela" mora em docstrings (`modelo.py:17-36`, `cor.py:1-43`, `grafo_audio.py:1-64`,
`.agents/rules/nle-parity-and-media-lifecycle.md`) e é conferida por camadas fracas: texto do grafo, fórmulas isoladas e um render de
fumaça (tabela 2.1). **Ninguém olha a imagem nem o som do arquivo que o `montar_comando` de verdade produz, e ninguém compara com o
que o Program mostra.**

O que o Fernando ganha:

1. **Rede de segurança para as frentes seguintes.** Áudio pelo `OfflineAudioContext`, clipe HTML, LUT, legendas queimadas,
   automação de volume e rampas de velocidade mudam, todas, o caminho que gera pixels ou amostras. Cada uma entra com um JSON de
   cenário (seção 6) e uma linha de limiar.
2. **Alarme de deriva do ambiente.** Uma atualização do Edge (decodificação, cor) ou do ffmpeg muda o arquivo sem que ninguém mexa
   no Talho; o harness diz *o que* mudou, em dB e com PNG de diferença.
3. **Números no lugar de avisos.** O banner de fidelidade carrega "2,06 dB no joelho do compressor" e "detector do gate, ainda não
   medido" (`fidelidade.py:47-62`); o Nível 2 de áudio fecha as duas pontas com limiar.
4. **Bugs reais, cedo.** Seção 2.6: seis candidatos medidos em minutos, três deles visíveis ao usuário.

**Dois níveis, valores diferentes.** *Nível 1, regressão do export contra referência aprovada:* barato (≈ 0,7 s por render de 5 s a
320×180 [medido]), determinístico, roda sem navegador e entra primeiro. *Nível 2, paridade player × export:* caro (navegador, seek,
decodificação), é o único que prova a regra "paridade com a tela" de ponta a ponta e o único que responde às perguntas que a pesquisa
deixou abertas (`--force-color-profile=srgb`, `docs/PESQUISA_HYPERFRAMES.md` §4.4).

**Fora do escopo:** qualidade perceptual do H.264 final; benchmark de desempenho (um *perf gate* como `HF:packages/producer/src/perf-gate.ts`
pode vir depois); testes de interface; corrigir os desvios achados (cada correção é commit próprio, depois do teste que a exige).

---

## 2. Estado atual no Talho

### 2.1 O que os testes de render conferem hoje

| Teste | O que confere | O que não cobre |
|---|---|---|
| `tests/test_render_composicao_multipista_cascata.py` (5 testes) | substrings do `filter_complex` e das `entradas` do cenário canônico | nenhuma imagem, nenhuma execução |
| `tests/test_render_blend_pixel.py:78-100` (22 casos, ffmpeg real) | pixel de `grafo_video.grafo_completo` contra a fórmula W3C; mídia trocada por cor sólida lavfi | só o grafo de vídeo, **sem a cadeia final de `montar_comando`** (`scale/pad/fps`, `comando.py:709-721`), sem decodificação, sem YUV, sem áudio |
| `tests/test_render_fade.py:189` | expressão de fade avaliada pelo ffmpeg contra `fade.avaliar` | a curva, não o clipe |
| `tests/test_render_titulos.py:157` | desfoque da caixa do título (ffmpeg) contra o `backdrop-filter` do Chromium sobre xadrez, erro médio < 3 | é a **única** comparação navegador × ffmpeg; só título |
| `tests/test_render_in_out_proxies_matte.py:166-230` | `montar_comando` + ffmpeg terminam com código 0 e arquivo > 1000 bytes | nenhum quadro, nenhuma amostra |
| `tests/autoteste_*.mjs` (75 arquivos) | lógica do player com DOM falso | nenhum pixel |

Não há CI (sem `.github`), nem `conftest.py`, nem *markers* registrados em `pytest.ini` (6 linhas, sem `addopts`). Há `Dockerfile` (Python 3.12,
ffmpeg do Debian, `playwright install --with-deps chromium`) e `docker-compose.yml`.

### 2.2 Pontos de entrada do render que o harness usa [lido]

- `modelo.normalizar(dict)` (`modelo.py:268`) → `Sequencia`; `modelo.Pedido(timeline_id, kind, faixa, escopo, overrides, usar_proxies…)`
  (`modelo.py:645`); `Faixa(modo="in_out", inicio_s, fim_s)` (`modelo.py:581`).
- `midia.resolver_fontes(seq, pedido, buscar_midia=…, checar_drive=…)` (`midia.py:203-206`) aceita injeção: **dispensa banco e drive**.
  Fora do Windows `_drive_de` devolve `"C"` (`midia.py:125-126`) e `drive_responde` testa `C:\` (137-153), que não existe: sem
  `checar_drive` injetado o original vira "indisponível". O harness sempre passa `checar_drive=lambda l: True`.
- `comando.montar_comando(seq, pedido, destino, rel_midia=, cfg=, destino_validado=True, inicio_s=, fim_s=, titulos=)`
  (`comando.py:547-553`) é pura e devolve `{"cmd", "duracao_s", "parametros", "avisos"}`. Precedente de uso direto:
  `tests/test_render_in_out_proxies_matte.py:222-226`.
- `execucao.executar_agora` (`execucao.py:231`) → `_render_job` (412) **não serve**: chama `midia.resolver_fontes` sem injeção (429), lê
  `SettingsService` (449), usa `TASK_MANAGER` e escreve `.parcial.mp4`.
- `Pedido.overrides` aceita só `resolution`, `fps`, `crf`, `audio_bitrate`, `mute_audio` (`comando.py:209-254`). **Codec, pix_fmt e
  container não são configuráveis.** O encoder sai de `_resolver_encoder` (`comando.py:259-292`) → `resolve_encoder_pipeline`
  (`src/media/ffmpeg.py:274-295`): com `auto` tenta QSV/NVENC/AMF sondando o ffmpeg (`ffmpeg.py:243-258`). No i7-10700 (UHD 630) o
  `auto` provavelmente vira `h264_qsv` [inferência] — não determinístico e diferente do libx264 dos testes.
- Sem `overrides["resolution"]` o preset `master_1080` escala tudo para 1920×1080 (`comando.py:149-155`, 710-716): 32 MB e ≈ 5× mais lento
  num cenário de 320×180 [medido].
- Cauda do comando: `-c:v <enc> <args> -c:a aac -b:a Nk -r FPS -t DUR [-movflags +faststart] -threads N -progress pipe:1 -nostats [-y]
  destino` (`comando.py:729-745`).
- Rotas `POST /api/timeline/{id}/render/preflight` e `/render` (`routes/narrative.py:1179`, `1197`) só montam `Pedido`+`Sequencia`
  (`_montar_seq_e_pedido`, 914) e enfileiram: o harness não precisa delas. `CAPIAU_DB_PATH` (`src/config.py:109`) permitiria um
  smoke de rota com banco temporário, opcional.

### 2.3 Como o Program compõe: DOM + CSS, não canvas [lido]

- `ProgramPlayer.syncVideoToPlayhead` (`player.js:3530-3935`) usa um *pool* de 4 `<video>` (`_videoPool`, 3942; `index.html:1089-1092`),
  2 `<img>` de foto (1095-1096), 2 `<div>` de cor sólida (1099-1100) e a camada de ajuste com **`backdrop-filter`**
  (`applyAdjustmentLayer`, 4508-4586; `buildCssBackdropFilter`, 88-118, que arredonda a 2 casas com `toFixed(2)`).
- Cor, blend e recorte por CSS no próprio elemento: `filter` (4738-4750), `mix-blend-mode` (4778-4779), `clip-path` (4792-4796),
  `transform` (4722). Fade/transição por `opacity` (4752-4776).
- **Só duas camadas de vídeo no ar:** *base* = a pista mais baixa que tem clipe ou transição, *sobreposição* = a mais alta entre as
  demais (`player.js:3646-3694`). Com três pistas de vídeo ocupadas, a do meio não é composta no DOM; o export empilha todas
  (`grafo_video.py:18`).
- **Segundo caminho de composição:** com *render cache* o Program desenha um canvas (`player.js:3576-3623`;
  `RenderCacheManager.compositeFrame`, `renderCache.js:335`, usa `globalCompositeOperation`, 370 e 518). O harness pode ler esse canvas
  com `getImageData`, sem *screenshot*.
- Tamanho do palco: `syncProgramViewport` (`player.js:2466-2525`) fixa o viewport em `largura×altura da sequência × escala`; com
  `TIMELINE_STATE.previewZoom = 1` há 1 px de tela por pixel da sequência e nada é reamostrado.
- Seek: `TIMELINE_STATE.setPlayheadFrame(n)` (`timelineState.js:3314`; **sai sem fazer nada se o quadro não mudou**) emite
  `timelinePlayheadChanged`, que chama `syncVideoToPlayhead` (`player.js:2572`). O buffer recebe `el.currentTime = alvo`
  (`_prepareBuffer`, 4138 e 4164; alvo em `_targetSecondsFor`, 4016-4057) e o `seeked` reentra no `syncVideoToPlayhead`
  (`_awaitBuffer`, 4071).
- Fonte do vídeo: `_videoSrcForCut` (3992-4013) usa `proxy_path` que comece por `/` ou `http`, senão `videoData.src`, senão
  `/api/video/{id}/stream`. **`src` arbitrário injeta a mídia sem API.**
- Globais já públicas: `window.STATE` (`state.js:389`), `window.TIMELINE_STATE` (`timelineState.js:8305`), `window.player`
  (`player.js:6588`, `main.js:1870`; `window.player.programPlayer`).

### 2.4 Contratos e invariantes que não podem quebrar

- Regras **P1–P8** de `modelo.py:17-36` e "o render lê do banco em segundos e deriva os frames com o fps da sequência".
- Regras NLE: pareamento por `transitionId`, handles, `tpad=clone` nas bordas sem folga, *clamping* de meia-transição,
  *cross dissolve* sem mergulho espúrio; *decoders* on-air intocáveis; `bitmap.close()` em todo descarte de cache.
- **Cenário canônico:** `pytest tests/test_render_composicao_multipista_cascata.py` e `node tests/autoteste_composicao_multipista_cascata.mjs`
  continuam obrigatórios; o teste de pixel do Nível 1 é **adicional** e entra na mesma regra (etapa 5).
- Master = original, rascunho = proxy, original ausente nunca cai calado; nunca escrever em `F:` (`midia.py:1-29`, 107-118).
- O harness **não altera produção**: `montar_comando` continua puro; o desvio de codec é feito no teste. Exceções são as correções
  de bug, uma a uma, com aval.
- Sem baixar nada e sem `playwright install`: o navegador é o Edge/Chrome já instalado (`titulos.CANAIS`, `titulos.py:62`).

### 2.5 Correções à pesquisa anterior (`docs/PESQUISA_HYPERFRAMES.md`)

1. **§4.8 "Não há comparação da imagem renderizada" está impreciso.** Existem pixel-tests de `grafo_video` contra a fórmula W3C
   (`test_render_blend_pixel.py`) e contra o Chromium (`test_render_titulos.py:157`). O que falta é a imagem do **arquivo** produzido
   por `montar_comando`, o **som**, e a comparação com o **Program**.
2. **§4.8 "psnr.ts é só ffmpeg -lavfi psnr" descreve a peça errada.** `HF:packages/engine/src/utils/psnr.ts` serve à auto-verificação
   do *drawElement* (JPEG). O harness de regressão tem a própria `psnrAtFrames` (`HF:packages/producer/src/regression-harness.ts:627-704`),
   que seleciona **por índice** com `select`+`settb=1/1,setpts=N` porque o pareamento por PTS combinava quadros errados (80 de 100
   *checkpoints* a mais de 2 dB do certo, comentário em 596-611).
3. **O HF é um gate frouxo, não um modelo de rigor.** São 100 *checkpoints* por teste (`regression-harness.ts:1308`), não "quadro a
   quadro"; `minPsnr` é 30 dB em 61 de 82 fixtures [medido por `grep` nos `meta.json`]; `minAudioCorrelation` é 0 (gate desligado) em 45
   e `maxAudioLagWindows` é 120 janelas (≈ 7,7 s) em 37; e o README admite que o render novo não chega a 50 dB contra o golden nem
   dentro do Docker (`HF:packages/producer/tests/README.md`, "encoder/JPEG-capture jitter"). O Talho, com intermediário sem perdas, pode
   exigir ≥ 50 dB e igualdade exata nos casos analíticos.
4. **§4.4 deixa em aberto "`--force-color-profile=srgb` precisa de teste contra o preview no Edge do usuário".** O Nível 2 é esse
   teste; os *flags* de referência estão em `HF:packages/engine/src/services/browserManager.ts:1061-1063` e `1096`.
5. **§3 "paridade de cor conferida à mão":** para `cor.py` (CSS → `lutrgb`) não há teste de pixel; só o blend e o desfoque do título têm.
6. **Esforço:** "M (1–2 semanas)" é coerente com o corte mínimo (≈ 5 dias); com os dois níveis completos são ≈ 15 dias úteis.

### 2.6 Desvios candidatos já medidos (o harness existe para pegá-los)

| # | Achado | Evidência | Quem pega |
|---|---|---|---|
| 1 | **O export sai 1 quadro mais curto** (95 em vez de 96; 143/144; 71/72; MP4 real com 3,958 s) | o `fps=N` final (`comando.py:717`) depois de `overlay` perde o último quadro; sem esse filtro: 96; `tpad=stop_mode=clone:stop_duration=0.05` antes dele: 96. 2× e freeze não perdem [medido: `montar_comando` do HEAD, ffmpeg 6.1.1]. No 7.1.4: **[a medir]** — `ffprobe -count_frames -select_streams v -show_entries stream=nb_read_frames export.mp4` | cenário 2 |
| 2 | **Reverso: export e fórmula do player diferem em 1 quadro** | export mostra o quadro 47 primeiro (in=0, out=2, 24 fps); a fórmula do player `outSec - offsetSec` (`player.js:4033`) manda o quadro do instante `out` (48) [medido no export; o lado do player é inferência] | cenário 3 e Nível 2 |
| 3 | **HD sai sem etiqueta de cor** | `ffprobe` do export: `color_space=unknown`, `yuv420p`; a conversão RGB→YUV interna é BT.601 (padrão do swscale); um visualizador que assume BT.709 em HD [web: `codereview.chromium.org/1230593005`, 2016, reconfirmar na versão atual] vê 28,7 dB contra o ideal, ou 44,9 dB se assumir 601 [medido: barras SMPTE 709, 320×180, matriz forçada na leitura com `scale=in_color_matrix`]. `grep` em `src/export/video_render/` não acha `out_color_matrix`, `-colorspace` nem `zscale`. Confirmar: `ffprobe -v error -select_streams v -show_entries stream=color_space,pix_fmt,profile export.mp4` | cenário 6 |
| 4 | **"bezier" não é curva conhecida** | `CURVAS_CONHECIDAS` (`fade.py:40`) não a lista; cai em `linear` (`fade.py:73-81`) no render e no player. O canônico atual usa `"bezier"` (`tests/test_render_composicao_multipista_cascata.py:84-85`) | cenário 1 usa `s_curve` além de `bezier` |
| 5 | **Três pistas de vídeo ao mesmo tempo** | Program compõe base + sobreposição (`player.js:3646-3694`); export empilha todas [lido; efeito é inferência] | cenário 7 (Nível 2) |
| 6 | **Desfoque de clipe vs. de título** | `cor.py:229` usa `gblur=sigma=N` puro; `titulos.py:65-66` mediu `1,05·N` com `steps=4` para o `blur(Npx)` do Chromium [lido; diferença de raio é inferência] | cenário 9 (Nível 2) |

---

## 3. O que o HyperFrames tem

Licença Apache-2.0 → GPLv3 permitido; ao portar, manter "Copyright 2026 HeyGen, Inc.", a licença e a indicação de alteração no
cabeçalho. Na prática só **três funções de áudio** e **a ideia do pareamento por índice** serão reescritas em Python; o resto é
inspiração. O HF é TypeScript/bun: nada é copiado literalmente.

| Peça | Onde | Decisão | Por quê |
|---|---|---|---|
| `psnrAtFrames`: PSNR por **índice** de quadro (`select` + `settb=1/1,setpts=N`, `shortest=1:repeatlast=0`, conferência de contagem) | `HF:packages/producer/src/regression-harness.ts:593-704` | **adaptar** | A lição vale ouro: parear por PTS combinou quadros errados (comentário 596-611). No Talho: `extrair_quadros` (novo) por índice + `assert len == esperado`; métrica em numpy (spawn de processo é caro no Windows, `scripts/auditar_cor.py:20-22`) |
| 100 *checkpoints* e `frameIndexForCheckpoint` | `HF:packages/producer/src/regression-harness.ts:587`, `1308` | **só inspirar** | Talho escolhe quadros-chave com significado (início/meio/fim de cada transição) e guarda uma tira de miniaturas de **todos** os quadros |
| `meta.json` (`minPsnr`, `maxFrameFailures`, `minAudioCorrelation`, `maxAudioLagWindows`) + `validateMetadata` | `HF:packages/producer/src/regression-harness.ts:69-153`, `300-431`; `HF:packages/producer/tests/README.md` | **adaptar** | `cenario.json` com limiares por métrica e por perfil (estrito/deriva), validado ao carregar |
| `--update` só dentro do Docker | `HF:packages/producer/tests/README.md`, "Generating / updating a baseline" | **adaptar** | No Windows do Fernando o fluxo é nativo (há `scripts/run-docker.ps1`, mas o render é medido no ffmpeg local): aprovação por CLI + impressão digital do ambiente (seção 6) |
| `buildRmsEnvelope`, `correlationAtLag`, `compareAudioEnvelopes` | `HF:packages/producer/src/utils/audioRegression.ts:1`, `15`, `65` | **portar reescrevendo** (numpy) | Envelope RMS (mono 16 kHz, janela 2048/hop 1024) é bom diagnóstico de forma; no Talho a folga de *lag* é ≤ 2 janelas (HF aceita 120) |
| `computeAudioResidualRmsDb`: subtrair, `astats`, pré-checar duração com 5 ms | `HF:packages/producer/src/utils/audioRegression.ts:140-245` (tolerância em 163) | **portar reescrevendo** | O teste nulo é o gate certo para áudio determinístico; a pré-checagem evita que `amix duration=shortest` esconda cauda perdida. Em numpy: SNR, resíduo em dBFS e comprimento em amostras |
| `saveFailureDetails`: ao falhar grava quadros e JSON com "por quanto" | `HF:packages/producer/src/regression-harness.ts:755-947` | **só inspirar** | Relatório do Talho: PNG referência \| atual \| diferença ×8, `resultado.json`, `index.html` |
| `parity-harness.ts`: preview × producer no mesmo Chrome (seek, 2 rAF ou 100 ms, screenshot, `blend=all_mode=difference`, `summary.json`) | `HF:packages/producer/src/parity-harness.ts:103`, `233-276` | **inspirar** | É o desenho do Nível 2. Não serve a **igualdade por SHA-256** (só vale com o mesmo motor dos dois lados); aqui o outro lado é o ffmpeg |
| *Flags* do Chromium: `--font-render-hinting=none`, `--force-color-profile=srgb`, `--force-device-scale-factor=1`, `--autoplay-policy=no-user-gesture-required` | `HF:packages/engine/src/services/browserManager.ts:1061-1063`, `1096`; `HF:packages/producer/src/parity-harness.ts:322-332` | **portar a lista** (strings) | Medir no Edge do Fernando com e sem `srgb` (resolve a dúvida de `PESQUISA` §4.4) |
| BeginFrame / `--deterministic-mode` | `HF:packages/engine/src/services/browserManager.ts:318-324`, `1132` | **não aproveitar agora** | Exige *headless-shell*; 1 screenshot por *checkpoint* não precisa |
| Goldens em Git LFS | `HF:.gitattributes` (`packages/producer/tests/**/*.mp4 filter=lfs`) | **não adotar** | Talho versiona PNG de 5–8 KB e fontes de 10–30 KB [medido: 7 KB por quadro, 6,7 KB por fonte] |
| `perf-gate.ts` (tempo contra baseline); `plan-parity-*`, `regression-harness-distributed.ts`, Lambda | `HF:packages/producer/src/` | **inspirar** o *gate* de tempo; **não aproveitar** o render distribuído | Gate de desempenho fica para depois; render distribuído está fora do Talho |

---

## 4. Verificações de viabilidade

### 4.1 Dá para medir a paridade REAL player × export automaticamente?

**Veredito: viável com ressalva** (codec do navegador, crominância/matriz e *seek* no headless).

- **Como compõe:** DOM + CSS; canvas só no *render cache* (2.3). Duas rotas medíveis: *screenshot* do `#program-player-viewport` (DOM) e
  `compositeFrame` → `getImageData` (cache), as duas contra o mesmo quadro do export.
- **Seek programático:** existe (`TIMELINE_STATE.setPlayheadFrame` → `syncVideoToPlayhead`). Como ele ignora o mesmo quadro
  (`timelineState.js:3316`), o gancho chama `window.player.programPlayer.syncVideoToPlayhead()` quando precisa repetir. O *render cache*
  tem de estar vazio (`RENDER_CACHE_MANAGER.hasFrame(n)` falso, `player.js:3578`), senão o DOM é pulado.
- **Timeline sem banco:** sim, pelo mesmo caminho de `panels.js:3809-3826` (`applyTimelineDetailToScreen`): `TIMELINE_STATE.setTracks`
  (`timelineState.js:1317`), `setTimelineProperties` (7713), `cortesDoBanco` (`timelinePersistencia.js:109`) e o *setter*
  `STATE.activeTimelineCuts` (`state.js:158`); mídia por `STATE.allVideos`/`allPhotos` (`state.js:321-328`) com `src` próprio
  (`player.js:4009`). **Rotas de API que o Program precisa: nenhuma** (o app real usaria `GET /api/timeline/{id}`, `api.js:513`; `GET /api/video/{id}/stream`, `routes/media.py:1314`; e o estático `/proxies`, `server.py:160`) [inferência: `ProgramPlayer` importa `api.js` mas não o chama na
  construção; confirmar na primeira execução].
- **Gancho mínimo, sem poluir a produção:** nenhuma linha em `src/`. Um `gancho.js` (novo) vive em `tests/render_regressao/paridade/` e
  só a página-harness o carrega, expondo `window.__talhoTeste`:
  `carregar({sequencia, videos, fotos})` (aplica o caminho acima, `previewZoom=1`), `irParaQuadro(n)` → `Promise<{quadro, camadas:[{clipId,
  mediaTime, alvo}]}>` (acomoda e devolve o quadro de origem que cada `<video>` mostra), `lerCacheDoQuadro(n)` (canvas do cache em RGBA) e
  `ambiente()` (`userAgent`, `canPlayType` de H.264/VP9, renderer GL). Se o Fernando quiser o gancho dentro do app (`?teste=1`), vira
  `src/ui/js/ganchoTeste.js` (novo) com `import()` dinâmico em `main.js`; **não recomendo agora** (outra sessão mexe em `main.js` e `index.html`).
- **Protocolo de acomodação** (o ponto frágil): `setPlayheadFrame(n)` → esperar todo `<video>` visível com `!seeking`, `readyState ≥ 2` e
  `|currentTime − alvo| < 0,5/fps` → `requestVideoFrameCallback` até `mediaTime ≈ alvo` [web: MDN `HTMLVideoElement.requestVideoFrameCallback`;
  `web.dev/articles/requestvideoframecallback-rvfc`; o callback pode vir 1 *vsync* atrasado] → 2 `requestAnimationFrame` → *screenshot*.
  Teto de 3 s por quadro e uma repetição; estouro vira falha com o motivo, não *flaky* silencioso. O **código de barras** confirma o
  quadro de origem independentemente do `mediaTime`.
- **Codec:** o Chromium do Playwright não tem H.264/AAC [web: `groups.google.com/a/chromium.org/g/chromium-discuss/c/dKsakieXVIY`,
  `github.com/chromiumembedded/cef/issues/3559`]; Edge/Chrome têm, mas não achei afirmação oficial do Playwright e os fóruns divergem sobre o `channel`.
  Solução: `titulos.CANAIS` (`msedge`, `chrome`, `None`) + `canPlayType('video/mp4; codecs="avc1.640028"')` no teste; se falhar, a mesma
  cena usa a fonte `.webm` (VP9). Export e navegador leem o mesmo arquivo, então a escolha não afeta a comparação.
- **Cor e crominância** [medido, ffmpeg 6.1.1]: no caminho padrão `yuv420p→rgb24` o swscale ignora `flags=bilinear` e `neighbor` (saída
  idêntica) e só muda com `accurate_rnd+full_chroma_int`: indício de que replica o croma; o navegador interpola [inferência]. Essa diferença já dá 29,3 / 32,8 / 45,0 dB de PSNR cheio (testsrc2 / barras SMPTE / gradiente), mas **luma 42,6 / 45,9 /
  46,5 dB** e **blocos 8×8 42,0 / 45,5 / 47,5 dB**. Matriz 601 no lugar de 709, ou faixa trocada, dá **25–28 dB em qualquer métrica**. Há
  ≈ 15 dB entre "diferença benigna" e "erro de convenção": os limiares do Nível 2 usam luma e blocos, e o croma é conferido por média
  de bloco 16×16. Sem etiqueta, o Chromium assume 601 abaixo de 720 de altura e 709 a partir dela [web: `codereview.chromium.org/1230593005`, 2016, reconfirmar]:
  as fontes sintéticas são **etiquetadas** (709, tv) e um cenário HD cobre o caso sem etiqueta; opcional (Nível 2b): tocar o MP4 exportado no mesmo Chromium dispensa a suposição de visualizador, só no cenário 6.
- **Custo de execução:** ≈ 7 s por cenário (Edge ≈ 1,5 s de partida, ≈ 0,4 s por quadro, render ≈ 1 s) [a medir]; esforço: etapas 9–11 (≈ 5,5 d).

### 4.2 Mídia sintética determinística

**Veredito: viável.** Fontes pequenas, **versionadas** (a decodificação H.264 é normativa, logo bit-exata entre versões do ffmpeg
[inferência]) e regeneráveis por script; o encode muda com a versão do x264 e com `-threads` [medido: `-threads 1` e `-threads 4` dão
MD5 diferentes], por isso **não** se gera no teste.

| Fonte (`tests/render_regressao/midia/`) | Conteúdo | Formato | Tamanho |
|---|---|---|---|
| `barras_a.mp4`, `barras_b.mp4` | gradiente de matiz distinto + **código de barras de 11 bits** (10 do nº do quadro, 1 da fonte) + marcadores de canto 8×8; 320×180, 24 fps, 6 s | H.264 CRF 18, `yuv420p`, BT.709 tv etiquetado | ≈ 10 KB cada [medido: 6,7 KB para 4 s] |
| `barras_a.webm`, `barras_b.webm` | idem, para Chromium sem H.264 | VP9 | ≈ 15 KB [a medir] |
| `barras_25.mp4`, `barras_2997.mp4`, `barras_60.mp4` | contagem de quadros em fps ≠ 24 | H.264 | ≈ 10 KB cada |
| `smpte_hd_709.mp4`, `smpte_hd_semtag.mp4` | barras SMPTE 1280×720, 1 s: com e sem etiqueta | H.264 CRF 10 | ≈ 30 KB cada [a medir] |
| `foto.png` | gradiente + marcadores (Pillow, determinístico) 320×180 | PNG | ≈ 5–8 KB |
| áudio (não versionado) | seno 1 kHz −20 dBFS, ruído branco com `seed` fixo, degraus de nível, rajadas de tom; WAV PCM 48 kHz estéreo | gerado por `ffmpeg -f lavfi` no `tmp_path_factory` | 768 KB por 4 s |

O áudio não é versionado porque suas referências são analíticas ou por envelope; determinismo [medido]: duas execuções do render dão
resíduo máximo 0,0 e os mesmos MD5 com 1, padrão e 8 *threads*.

**Total versionado ≈ 1–1,5 MB:** fontes ≈ 150 KB, 18 cenários JSON ≈ 40 KB, referências ≈ 0,8–1,3 MB (≈ 6–10 PNG de 5–8 KB e uma tira de
miniaturas por cenário). **Como a mídia entra no render sem biblioteca nem banco:** `midia.resolver_fontes(seq, pedido,
buscar_midia=lambda tipo, i: {"filepath": caminho}, checar_drive=lambda l: True)` (`midia.py:203-206`), que é o que
`tests/test_render_in_out_proxies_matte.py:219-222` já faz. Para rascunho/proxy, `monkeypatch.setattr(CONFIG, "PROXIES_DIR", tmp)`
(`midia.py:99-100`). No Nível 2 a mesma fonte chega ao Program por `STATE.allVideos[i].src`.

### 4.3 Não-determinismo do encoder: intermediário sem perdas

**Veredito: viável, sem mudar produção.**

- **Render direto em Python, sem API:** sim (`tests/test_render_in_out_proxies_matte.py:166-230`).
- **O que dá para configurar:** faixa (`Faixa` ou `inicio_s/fim_s`), resolução, fps, `crf`, `mute_audio`, rascunho×master (`Pedido.kind`;
  rascunho = 540 de altura e `draft_crf=30`, `comando.py:70-81`, 223-231), proxy (`usar_proxies`) e escopo (`Escopo.categorias/pistas`).
  **Não dá:** codec, pix_fmt, container. "Alguns quadros" se resolve na extração (`select`), não no render.
- **Como:** o teste pega o `cmd` de `montar_comando`, corta tudo a partir de `-c:v`, guarda os valores de `-r` e `-t` e acrescenta
  `-c:v ffv1 -level 3 -c:a pcm_s16le -r R -t T -fps_mode cfr -y saida.mkv` [medido: funciona, 0,7 s por render de 5 s a 320×180, 2 MB].
  Um teste-guarda falha alto se a cauda de `comando.py:729-745` mudar de forma; `-r` e `-t` são preservados porque definem taxa e duração do arquivo real.
- **Forçar CPU:** `monkeypatch` de `src.media.ffmpeg.get_hardware_settings` → `("cpu", "none")` (`ffmpeg.py:234-241`, 276-277) para não
  sondar QSV/NVENC/AMF (cada sonda é um ffmpeg de até 4 s, `ffmpeg.py:243-258`) e evitar `SettingsService` real.
- **Sempre** `overrides={"resolution": "LxA", "mute_audio": …}` com o tamanho da sequência (senão 1920×1080, 2.2).
- **Por que não comparar H.264** [medido: render canônico 320×180, 119 quadros, re-encode do intermediário]: CRF 18 → PSNR mínimo 44,0 /
  médio 48,1 dB; CRF 23 → 39,9 / 44,3; CRF 30 (rascunho) → 35,2 / 39,0; SSIM mínimo 0,990 / 0,979 / 0,947. Um limiar que aguenta o ruído do
  codec deixa passar a regressão real; o intermediário sem perdas permite ≥ 50 dB. O arquivo H.264 **real** entra num teste à parte, só por
  `ffprobe` (contagem de quadros, duração, `profile`, `pix_fmt`, etiquetas, trilha de áudio).
- **Determinismo do intermediário** [medido]: `framemd5` do vídeo e MD5 do áudio idênticos com `-threads/-filter_threads/-filter_complex_threads`
  = 1, padrão e 8. Entre CPUs diferentes o swscale pode variar ±1 [inferência: o SIMD não é *bitexact* sem `+bitexact`], daí o perfil "estrito"
  tolerar `max_abs ≤ 2`.

### 4.4 Métricas e limiares

**Veredito: viável.** Métricas em numpy + Pillow (já em `requirements.txt`): PSNR, `max_abs`, fração de pixels acima de 4 níveis,
PSNR de luma, PSNR por blocos 8×8, SSIM de luma (janela uniforme 7×7, implementação própria; cruzada com o `ssim` do ffmpeg:
|Δ| ≤ 0,02 [medido: 0,017 em 10 quadros] — limiares de SSIM só valem para a implementação que os gerou), mapa de diferença (×8). Áudio:
RMS por janela (50/100 ms), SNR/resíduo por teste nulo, correlação de envelope (diagnóstico), frequência dominante (FFT), instante de início
por rajada, comprimento em amostras. **Quadros falhos:** 0 nos oráculos e nos quadros-chave (como `maxFrameFailures: 0` dos fixtures do HF); na tira de miniaturas, no máximo 1 % dos quadros com erro médio de luma acima de 2 níveis (absorve a borda das transições). Dois perfis: **estrito** (mesmo `ffmpeg -version` da aprovação) e **deriva** (ffmpeg diferente).

| Caso | Métrica | Estrito | Deriva | Base |
|---|---|---|---|---|
| Qualquer quadro-chave contra referência aprovada | PSNR / `max_abs` / SSIM | ≥ 50 dB / ≤ 2 / ≥ 0,995 | ≥ 42 dB / ≤ 6 / ≥ 0,985 | [medido] idêntico com 1/8 *threads*; H.264 daria só 44–48 dB |
| Cor CSS → `lutrgb`/`colorchannelmixer` contra Filter Effects em numpy | `max_abs` / PSNR | ≤ 3 / ≥ 48 dB | ≤ 4 | [medido] estágios de 8 bits contra pipeline em ponto flutuante: máx. 1–3 níveis, 52–60 dB |
| Desfoque da caixa do título | erro médio no interior da caixa | < 3 níveis (limiar do teste atual, `test_render_titulos.py:213`) | < 4 | [lido] |
| Transformações (escala, `x/y`, 90°/180°/270°, crop) | centroide de marcador | ≤ 1 px | ≤ 1 px | [inferência] |
| Rotação livre (15°) | SSIM com máscara de borda de 2 px | ≥ 0,95 | ≥ 0,93 | [a medir] (interpolação difere) |
| Dissolve (metamórfico) | meio = (A+B)/2 em área plana; α(t) de B lido do 11º bit da fonte (A preto, B branco) | ± 3; α ± 0,01 | ± 4; α ± 0,02 | [medido] α segue a rampa linear de 24 quadros com erro máx. 0,0033 |
| Dip preto/branco | meio da transição | ± 2 | ± 3 | — |
| Camada de ajuste + blend | contra fórmula W3C; bypass contra "sem camada" | ± 6; bypass = 0 | ± 6; bypass ≤ 1 | `test_render_blend_pixel.py:21` |
| Velocidade/reverso/freeze/corte/trim | nº do quadro de origem por quadro de saída | 0 divergências | 0 | [medido] o oráculo funciona (2.6) |
| Contagem e tempo | nº de quadros, duração, amostras | igualdade exata | igualdade exata | [medido] hoje falha por 1 quadro |
| Ganho/fade/mute | RMS por janela de 50 ms contra o analítico | ≤ 0,15 dB; mute ≤ −90 dBFS | ≤ 0,3 dB | [inferência] |
| Crossfade *equal power* (ruído descorrelacionado, com handles) | RMS plano na transição | ± 0,4 dB | ± 0,6 | [medido] −18,10…−18,30 dBFS em janelas de 100 ms |
| Mesmo, sem handle no clipe B | queda máxima | ≤ 1,5 dB | ≤ 2 | [medido] ≈ 1,2 dB (comportamento documentado) |
| J/L-cut | início do som | ≤ 1 ms | ≤ 1 ms | [lido] `adelay` em ms inteiros (`grafo_audio.py:516`) |
| EQ / dinâmica | ganho por banda; curva do compressor | ≤ 0,5 dB; regressão do `acompressor` | ≤ 0,8 dB | [inferência] |
| Teste nulo de áudio (duas execuções) | resíduo / SNR | 0 / ≥ 90 dB | ≥ 60 dB | [medido] resíduo máx. 0,0 |
| Nível 2, vídeo sem decodificador (matte, foto) | `max_abs` em áreas planas / PSNR | ≤ 4 / ≥ 45 dB | — | [medido] quantização; **a calibrar** |
| Nível 2, blend e `backdrop-filter` | idem | ≤ 6 / ≥ 40 dB | — | `test_render_blend_pixel.py:21`; **a calibrar** |
| Nível 2, vídeo decodificado | PSNR de luma / PSNR por blocos 8×8 / croma por bloco 16×16 | ≥ 38 dB / ≥ 40 dB / ≤ 6 níveis | — | [medido] 42–47 dB só por croma; convenção errada 25–28 dB; **a calibrar** |
| Nível 2, tempo | quadro de origem mostrado (`mediaTime` e código de barras) | = esperado | — | [web] rVFC |
| Nível 2, áudio (após a frente de áudio) | compressor / gate | ≤ 2,1 dB hoje, ≤ 0,2 dB depois / início do gate ≤ 3 ms | — | `fidelidade.py:47-62`; bloco de 128 amostras = 2,7 ms |

**Calibração do Nível 2:** 10 execuções na máquina do Fernando; limite = pior valor observado − 3 dB (ou + 2 níveis), gravado em
`limiares_nivel2.json` (novo) com data e versão do navegador.

### 4.5 Deriva de versão (ffmpeg e Chromium)

**Veredito: viável com ressalva.**

- **O HF** gera tudo em Docker e versiona goldens em Git LFS; mesmo assim o render novo não chega a 50 dB contra o golden e o gate é de 30 dB
  (2.5, item 3). O fluxo diário do Fernando é o Windows nativo [inferência: há `scripts/run-docker.ps1`, mas as medições do render citam o ffmpeg local, `execucao.py:28`]. O código já cita **dois** ffmpeg: 7.1.4 (`execucao.py:28`) e 5.1 (`comando.py:777`).
- **Razoável no Windows:** (1) **não fixar** a versão do ffmpeg; (2) gravar a **impressão digital** (linha de `ffmpeg -version`, SHA do
  `-buildconf`, Python, numpy, Pillow) em cada aprovação; (3) **dois perfis** de tolerância: estrito se a impressão digital bate, deriva se
  não; (4) quando um teste falha *e* a impressão digital mudou, o relatório diz "ambiente mudou desde a aprovação" e propõe `aprovar` depois
  de ver o PNG; (5) o Nível 2 **não guarda referências** (compara ao vivo), então Edge/Chromium novos só mexem na calibração, e a versão do
  navegador sai no relatório.
- ***Markers*:** `needs_ffmpeg` (pula sem ffmpeg/ffprobe no PATH), `needs_browser` (pula sem Playwright + Edge/Chrome, mesma sondagem de
  `tests/test_render_titulos.py:124`), `slow`, `render_golden` (Nível 1), `paridade` (Nível 2). Registrados em `pytest.ini`; `paridade` fica
  **desligado por padrão** (`--paridade` ou `CAPIAU_PARIDADE=1`), o Nível 1 liga sozinho quando há ffmpeg.
- **Sem CI hoje.** Receita opcional depois: `docker build` do `Dockerfile` e `pytest -m "render_golden"` (Chromium do Playwright cobre o
  título; o Nível 2 de vídeo usaria a fonte VP9).

### 4.6 Cenários iniciais, em ordem de valor

Todos em 320×180 @ 24 fps, 3–6 s, exceto onde dito. **N1** = regressão do export; **N2** = paridade com o Program. "Oráculo" = sem arquivo de
referência. Limiares na tabela 4.4.

| # | Cenário (`id`) | Monta | Mede | Limiar | N |
|---|---|---|---|---|---|
| 1 | `canonico_cascata` | V1: `clip_a` [0,3) e `clip_b` [3,6) com `in=1` (handles), dissolve de 1 s (0,5 s para cada lado do corte, quadros 60–83) com `transitionId`, cor por clipe (brilho +10 / contraste +15); V2: ajuste [2; 4,5) `soft-light`, saturação 150, fades 0,5 s `bezier` e variante `s_curve`; A1 pareada | 144 quadros; IDs de A/B contra o oráculo; 9 quadros-chave contra a referência (antes, início, meio e fim do dissolve, ajuste a 50 % do fade-in, pleno, 50 % do fade-out, depois, último); **bypass** (`disabled:true`) = sem camada, `max_abs = 0` em todos os quadros; tira de miniaturas | contagem e IDs exatos; quadro-chave ≥ 50 dB / `max_abs` ≤ 2; bypass 0 | 1, 2 |
| 2 | `contagem_e_tempo` | 1 clipe, fps 24/25/29,97/30/60, com e sem faixa IN/OUT; saída real (libx264/aac) e intermediário | nº de quadros = `round(dur×fps)`, duração do contêiner, amostras de áudio, IDs do primeiro e do último quadro | igualdade exata (hoje: 1 quadro a menos) | 1 |
| 3 | `velocidade_reverso_freeze` | 0,5×, 2×, reverso, reverso 2×, freeze (`is_freeze`), rotação 90° | ID de origem por quadro contra `Clipe.trecho_fonte` + fórmula do player (`player.js:4033`); N2: `mediaTime` do `<video>` do Program | 0 divergências (reverso hoje diverge) | 1, 2 |
| 4 | `corte_trim_razor` | dois clipes contíguos no mesmo arquivo e em arquivos distintos, `in/out` ≠ 0, clipe com início deslocado (preto antes), faixa IN/OUT no meio | IDs por quadro; nos 6 pontos de virada o quadro mostrado no Program | 0 divergências; N2: quadro mostrado = esperado | 1, 2 |
| 5 | `dissolve_dip_handles` | dissolve com handles; com `hard_boundaries` (`tpad=clone`); clipe curto (*clamp* `min(half, a, b)`); `video_dip_black`; `video_dip_white` | IDs na janela (A continua, B recua; com `tpad` congelam); α(t) lido do 11º bit (A preto, B branco); meio = (A+B)/2; dip = preto/branco | IDs exatos; meio ± 3 (dissolve) e ± 2 (dip) | 1, 2 |
| 6 | `cor_hd_matriz` | 1280×720, 2 quadros, fonte SMPTE com e sem etiqueta 709; export lido como visualizador HD (709) e SD (601) | PSNR contra o ideal; `ffprobe`: `color_space` (hoje `unknown`) | PSNR ≥ 40 dB (hoje 28,7); `color_space=bt709` | 1, 2 |
| 7 | `ajuste_e_pistas` | ajuste `multiply` com fade; ajuste com `crop`; dois ajustes empilhados; ajuste sobre transição; `disabled`; **três pistas de vídeo** ocupadas | W3C ± 6; bypass = 0; N2: a pista do meio deve aparecer (hoje `xfail`, 2.6 item 5) | W3C ± 6; bypass 0; pista do meio visível | 1, 2 |
| 8 | `blend_modes` | `multiply, screen, overlay, darken, lighten, difference, soft-light` × {matte sobre vídeo, vídeo sobre vídeo, ajuste} | fórmula W3C (hoje em `test_render_blend_pixel.py:27-51`; mover para `oraculos.py` (novo)); N2: `mix-blend-mode` | ± 6 (N1); ± 6 e ≥ 40 dB (N2) | 1, 2 |
| 9 | `cor_css` | brilho, contraste, saturação, matiz, sépia, cinza, desfoque e combinações que saturam canal (`cor.py:14-24`) sobre barras SMPTE e gradiente (matte/foto: sem decodificador) | Filter Effects em numpy, grampeando entre funções; N2: `filter` do Chromium; desfoque: erro de raio (2.6 item 6) | `max_abs` ≤ 3 e ≥ 48 dB (N1); ≤ 4 (N2) | 1, 2 |
| 10 | `fade_curvas` | cor sólida com fade in/out em `linear, exponential, logarithmic, s_curve, equal_power, custom (tensão ±0,5), bezier` | α(t) de `fade.avaliar` → pixel = α·cor; N2: `evaluateFadeCurve` | `max_abs` ≤ 2 (N1); ≤ 3 (N2) | 1, 2 |
| 11 | `geometria` | `fit/fill`, `scale`, `x/y`, rotação 0/90/180/270/15°, `crop`; fonte com marcadores de canto | centroides dos marcadores; rotação livre por SSIM com máscara de borda | centroide ≤ 1 px; SSIM ≥ 0,95 (15°) | 1, 2 |
| 12 | `matte_foto_kenburns` | matte com fade; foto PNG com `ken_burns` (`easeInOut`, *from/to*) | posição e escala do marcador pela fórmula do player (`player.js:4661-4672`); N2 estrito (sem decodificador) | ≤ 1 px; ≥ 45 dB (N2) | 1, 2 |
| 13 | `audio_ganho_fade_mute` | seno 1 kHz −20 dBFS: ganho de clipe, volume de pista, mute, fades por curva | RMS por janela de 50 ms; mute; comprimento exato em amostras | ≤ 0,15 dB; mute ≤ −90 dBFS; amostras exatas | 1 |
| 14 | `audio_crossfade` | ruído A/B descorrelacionado, `equal_power`, com e sem handles; seno correlacionado | RMS plano ± 0,4 dB (com handles); queda ≤ 1,5 dB (sem) | ± 0,4 dB (com handles); queda ≤ 1,5 dB (sem) | 1 |
| 15 | `audio_jl_cut` | par A/V com áudio adiantado (J) e atrasado (L) em relação ao corte | início do som ≤ 1 ms; sem lacuna nas costuras | início ≤ 1 ms | 1 |
| 16 | `audio_eq_dinamica_gate` | rajadas de 100 Hz/1 kHz/8 kHz; EQ low/mid/high e `hpf`; degraus −36…0 dBFS no compressor; gate | resposta por banda; curva do compressor; N2 áudio com a frente de áudio | ≤ 0,5 dB por banda; N2: ≤ 2,1 dB → 0,2 dB; gate ≤ 3 ms | 1, 2 |
| 17 | `titulo_caixa_desfoque` | título com `backgroundColor` translúcido sobre barras (640×360, `needs_browser`) | referência aprovada + erro médio < 3 na caixa; N2: texto do Program × export | ref. ≥ 50 dB; erro médio < 3 (N1 e N2) | 1, 2 |
| 18 | `audio_velocidade_mix_limiter` | 2× com `corrigir_tom` verdadeiro/falso; A1+A2 somadas com `alimiter` | frequência dominante 1000 Hz / 2000 Hz (± 1 %); pico ≤ −0,2 dBFS (`grafo_audio.py:97`); P3/P7 | frequência ± 1 %; pico ≤ −0,2 dBFS | 1 |

Cenários das frentes futuras (LUT, legendas queimadas, automação de volume, rampas, clipe HTML, áudio no navegador): tabela da seção 6.

---

## 5. Decisões de projeto

**D1. De onde vem a verdade da regressão.** (a) *Oráculos analíticos e metamórficos* (fórmula W3C/CSS, `fade.avaliar`, número do quadro,
"bypass = ausência"): sem arquivo, imunes à deriva, mas exigem uma fórmula. (b) *PNG aprovados pequenos* no Git: cobrem composições sem
fórmula, envelhecem com o ffmpeg, revisáveis por diff visual. (c) *Vídeos golden por Docker + LFS* (HF): ≈ 240 MB, Docker no Windows, e
mesmo assim só 30 dB. **Recomendo (a) onde houver fórmula, (b) nos cenários 1 e 17, nunca (c).**

**D2. Como obter quadros sem ruído do codec.** (a) Reescrever a cauda do `cmd` no teste: zero mudança em produção, usa o comando verdadeiro;
acopla à ordem `-c:v … -c:a … -r … -t` (mitigado por teste-guarda). (b) Opção nova em `Pedido.overrides` lida por `montar_comando`: sem
acoplamento, mas mexe no contrato "congelado" de `modelo.py`/`comando.py`. (c) Comparar H.264: 44–48 dB de ruído (4.3). **Recomendo (a);
(b) só se o guarda quebrar duas vezes.**

**D3. Página do Program no Nível 2.** (a) `index.html` real com `/api/**` stubado: layout real, mas o *boot* de `main.js`
(`WorkspaceManager`, *popouts*, *welcome hub*) pode cobrir o monitor e é frágil. (b) **Página-harness em `tests/`**, com o bloco
`#program-video-wrapper` extraído do `index.html` em tempo de teste e os módulos reais de `src/ui/js` servidos por `page.route`, como
`titulos._servir` já faz (`titulos.py:148-168`): estável e pequena, o DOM é o real; acopla a ids (teste-guarda). (c) FastAPI real com
`CAPIAU_DB_PATH` temporário: prova `/stream`, mas sobe *workers*/Qdrant e não é hermético. **Recomendo (b)**; (c) vira um smoke único e opcional.

**D4. Gancho de teste.** (a) Nenhum em `src/` (`gancho.js` em `tests/`) ou (b) `?teste=1` em `main.js`. **Recomendo (a):** `STATE`,
`TIMELINE_STATE` e `window.player` já são globais, e `main.js`/`index.html` têm outra sessão mexendo.

**D5. Mídia do Nível 2.** H.264 quando `canPlayType` aceitar (Edge/Chrome); senão VP9/WebM. Os dois arquivos estão no Git; export e
navegador leem o mesmo arquivo.

**D6. Métricas.** numpy + Pillow (já em `requirements.txt`) contra filtros `psnr`/`ssim` do ffmpeg: o filtro é padrão, mas é um
processo por par (≈ 150 ms no Windows, `scripts/auditar_cor.py:20-22`) e pareia por PTS. **Recomendo numpy**, com 1 teste de validação
cruzada (PSNR ≤ 0,05 dB de diferença; SSIM ≤ 0,02).

**D7. Divergência conhecida.** `xfail(strict=True)` com `reason` e o código do aviso de `fidelidade.py` (falha ao ser corrigida, obrigando a
tirar o marcador), contra alargar o limiar (esconde regressão) ou `skip` (esconde). **Recomendo `xfail` estrito.**

**D8. Aprovar referências.** (a) `pytest --update`: fácil demais de aprovar sem olhar. (b) **CLI de dois passos:** `gerar` grava candidatas e o
relatório em `_saida/`; `aprovar ID --motivo "…"` mostra o PSNR contra a referência atual, pede confirmação (`--sim` em script), copia, grava
`APROVADO.json` e acrescenta em `APROVACOES.jsonl`. O pytest nunca escreve em `referencias/` (teste-guarda). **Recomendo (b).**

**D9. Quando roda.** Nível 1 no `pytest` padrão quando há ffmpeg (alvo ≤ 60 s); Nível 2 por opção (`--paridade`). **Recomendo assim**;
sem CI por enquanto.

**D10. Tamanho dos cenários.** 320×180 @ 24 fps, 3–6 s (render ≈ 0,7 s, PNG ≈ 7 KB); título 640×360; HD só em `cor_hd_matriz` (2 quadros).
Resoluções maiores não acham mais bugs e custam tempo e Git.

---

## 6. Modelo de dados e compatibilidade

```
tests/render_regressao/
  cenarios/<id>.json                  # versionado (18 no início)
  referencias/<id>/quadro_<NNNN>.png  # versionado, ≤ 10 por cenário (5–8 KB cada)
  referencias/<id>/tira.png           # versionado: luma 32×18 de TODOS os quadros, 12 colunas (pega quadro deslocado ou faltando)
  referencias/<id>/audio.json         # versionado: RMS por janela de 100 ms, pico, nº de amostras
  referencias/<id>/APROVADO.json      # versionado: quando, motivo, commit, impressão digital do ambiente
  referencias/APROVACOES.jsonl        # versionado, só acrescenta
  limiares_padrao.json  limiares_nivel2.json
  midia/…                             # versionado (4.2)
  _saida/                             # ignorado pelo Git: candidatas, relatórios, PNG de diferença, resultado.json, index.html
```

`cenarios/<id>.json` (`schema: 1`); o campo `sequencia` é **exatamente o `sequence_json` v2 do banco**, que `modelo.normalizar` já consome:

```json
{ "schema": 1, "id": "canonico_cascata", "descricao": "Ajuste soft-light com fade sobre dissolve em V1",
  "marcadores": ["render_golden", "paridade"], "fps": 24, "resolucao": [320, 180],
  "fontes": {"1": "barras_a.mp4", "2": "barras_b.mp4"},
  "sequencia": { "version": 2, "fps": 24, "width": 320, "height": 180, "tracks": [ … ], "clips": [ … ] },
  "pedido": { "kind": "master", "faixa": null, "overrides": {}, "escopo": {} },
  "quadros_chave": [12, 54, 60, 72, 83, 90, 102, 130, 143],
  "oraculos": [ {"tipo": "contagem", "quadros": 144},
                {"tipo": "ids_de_origem", "pista": "V1", "sem": ["adj_v2"]},
                {"tipo": "metamorfico_bypass", "desligar": "adj_v2", "igual_a": "sem:adj_v2", "max_abs": 0} ],
  "limiares": { "estrito": {"psnr_min": 50, "max_abs": 2}, "deriva": {"psnr_min": 42, "ssim_min": 0.985} },
  "conhecidas": [ {"codigo": "FPS_ULTIMO_QUADRO", "motivo": "fps final perde 1 quadro", "xfail": ["contagem"]} ],
  "paridade": { "quadros": [12, 54, 72, 90, 102, 130], "familia": "video_composto" } }
```

- **Impressão digital do ambiente** (`APROVADO.json`): linha de `ffmpeg -version`, SHA-1 de `ffmpeg -buildconf`, Python, numpy, Pillow. Igual ⇒
  perfil estrito; diferente ⇒ perfil deriva e o relatório diz "ambiente mudou".
- **Compatibilidade com o render:** nenhum campo novo no banco nem no `Pedido`. Um `sequence_json` real que falhou no uso vira cenário copiando o
  campo `sequencia`. `conhecidas[].codigo` usa o `codigo` do aviso de `fidelidade.relatorio` quando existe (`JOELHO_COMPRESSOR_LIMITADO`,
  `DETECTOR_GATE_DIVERGENTE`) e um código do harness (`FPS_ULTIMO_QUADRO`) quando o desvio ainda não tem aviso; um teste avisa se o aviso sumiu e o `xfail` continua.
- **Versionamento:** o carregador recusa `schema` maior que o conhecido; `scripts/render_regressao.py migrar` (novo) sobe o esquema.
- **Como outra frente adiciona um caso:** (1) copiar um JSON de `cenarios/` e editar `sequencia`/`oraculos`/`limiares`; (2) se a medida é nova,
  uma função em `oraculos.py` ou `metricas.py` registrada em `REGISTRO_ORACULOS` (novo); (3) `render_regressao.py gerar --cenario X`, ver o
  relatório, `aprovar`. Cenário de frente ainda não implementada nasce com `xfail(strict)` apontando a frente.

| Frente | Cenário que ela traz | Medida |
|---|---|---|
| Áudio pelo navegador | `paridade_audio` | cadeia WebAudio no `OfflineAudioContext` × ffmpeg: compressor ≤ 0,2 dB, gate ≤ 3 ms |
| Clipe HTML | `clipe_html` | referência por quadro-chave + hash por quadro; N2 contra o iframe |
| LUT | `cor_lut_cube` | LUT identidade e de inversão = oráculo exato; N2 contra o caminho WebGL |
| Legendas queimadas | `legenda_queimada` | referência + paridade do texto (como o cenário 17) |
| Automação de volume | `audio_automacao_volume` | RMS por janela = curva ± 0,2 dB |
| Rampas de velocidade | `velocidade_rampa` | ID de origem por quadro segue `sourceTimeAt` (`HF:packages/core/src/speedRamp.ts:101`) |

---

## 7. Mudanças por arquivo

Tudo marcado **novo** é nome proposto por mim, inclusive as funções `ids_esperados`, `comando_intermediario`, `extrair_quadros`, `ler_ids` e `REGISTRO_ORACULOS` (novo).

| Arquivo | Novo/alterado | O que muda |
|---|---|---|
| `tests/render_regressao/__init__.py`, `conftest.py` | novo | pacote; `--paridade`; *markers*; fixtures de sessão (`ffmpeg_ok`, `navegador`, fontes); CPU forçada por `monkeypatch`; skip por *marker* |
| `tests/render_regressao/ajudantes.py` | novo | monta sequência, resolve fontes sem banco, `comando_intermediario`, renderiza, extrai quadros e áudio |
| `tests/render_regressao/fontes.py`, `midia/*` | novo | caminhos, geração de áudio, leitura do código de barras; fontes sintéticas versionadas |
| `tests/render_regressao/oraculos.py`, `metricas.py` | novo | `ids_esperados`, cor CSS, W3C, α de fade, centroides; PSNR/SSIM/blocos; envelope, resíduo, FFT, início do som |
| `tests/render_regressao/referencias.py`, `relatorio.py` | novo | carregar/gravar/aprovar, impressão digital, perfis; PNG lado a lado, `resultado.json`, `index.html` |
| `tests/render_regressao/cenarios/*.json`, `referencias/**`, `limiares_*.json` | novo | 18 cenários; ≈ 1 MB de referências |
| `tests/render_regressao/test_export_quadros.py`, `test_export_audio.py`, `test_export_saida_real.py` | novo | Nível 1 |
| `tests/render_regressao/paridade/{pagina_programa.html,gancho.js,navegador.py}`, `test_paridade_programa.py`, `test_paridade_audio.py` | novo | Nível 2 |
| `scripts/render_regressao.py` | novo | CLI: `ambiente`, `midia`, `gerar`, `relatorio`, `aprovar`, `migrar` |
| `pytest.ini` | alterado | `markers =` com `needs_ffmpeg`, `needs_browser`, `slow`, `render_golden`, `paridade` |
| `.gitignore` | alterado | `tests/render_regressao/_saida/` |
| `tests/test_render_blend_pixel.py` | alterado (etapa 6) | passa a importar `_modo_w3c` de `oraculos.py` (refatoração pura, mesmos 22 casos) |
| `.agents/rules/nle-parity-and-media-lifecycle.md` | alterado, **com aval** | §3.2 acrescenta `pytest tests/render_regressao -k canonico` aos critérios |
| `tests/render_regressao/LEIA-ME.md` | novo | rodar, aprovar, adicionar cenário, matriz regra × cenário |
| `src/export/video_render/comando.py`, `src/ui/js/player.js` | alterado **só em commits de correção**, com aval | `fps` final (2.6 item 1), etiqueta de cor HD (item 3), reverso (item 2), 3 pistas (item 5) |

---

## 8. Etapas de implementação

Um commit por etapa, mensagens em português no padrão *conventional commits*. Cada etapa termina com os dois canônicos
(`pytest tests/test_render_composicao_multipista_cascata.py`, `node tests/autoteste_composicao_multipista_cascata.mjs`) e
`pytest tests/test_render_*.py` verdes.

1. **`test(render): fontes sintéticas com código de barras e utilitários do harness`** — 1,0 d · sem dependências.
   Entra: `scripts/render_regressao.py` (`midia`, `ambiente`), `midia/*`, `fontes.py`, `ajudantes.py`, `conftest.py`, *markers* no `pytest.ini`, `.gitignore`.
   Testes: `test_fontes_sinteticas.py` (IDs lidos = 0…N−1 em mp4 e webm; etiqueta 709), `test_ajudantes_cauda.py` (guarda da cauda de
   `comando.py:729-745`; `-r`/`-t` preservados; resolução obrigatória; determinismo com 1 e 8 *threads*).
2. **`test(render): contagem de quadros, duração e etiquetas de cor da saída real`** — 0,75 d · dep. 1.
   Entra: cenários 2 e 6 (N1) e `test_export_saida_real.py` (`ffprobe` do H.264 real com CPU forçada).
   Testes: `xfail(strict)` nos itens 1 e 3 de 2.6 **se** ocorrerem no ffmpeg do Fernando (rodar antes e mostrar o resultado ao Fernando).
3. **`test(render): oráculo de quadro de origem para corte, trim, velocidade, reverso e freeze`** — 0,75 d · dep. 1.
   Entra: `oraculos.ids_esperados` (fórmula de `Clipe.trecho_fonte` e de `player.js:4033`), cenários 3 e 4. Testes: 0 divergências; reverso em `xfail`.
4. **`test(render): métricas de imagem, referências aprovadas e relatório de diferença`** — 1,5 d · dep. 1.
   Entra: `metricas.py`, `referencias.py`, `relatorio.py`, CLI `gerar|relatorio|aprovar|migrar`.
   Testes: diferenças conhecidas (idêntico = ∞; +1 nível; quadro deslocado; matriz 601×709 = 25–28 dB), PSNR/SSIM contra o ffmpeg, aprovação em
   pasta temporária, guarda "o pytest não escreve em `referencias/`", perfis por impressão digital.
5. **`test(render): cenário canônico multipista em cascata com referência aprovada e bypass`** — 1,0 d · dep. 4.
   Entra: cenário 1 e a parte de ajuste do 7; **primeira aprovação na máquina do Fernando, com o Fernando vendo o relatório**; regra do `.agents` (com aval).
   Testes: 144 quadros, IDs, 9 quadros-chave, bypass com `max_abs = 0`. *Fim do corte mínimo (≈ 5 d).*
6. **`test(render): transições, fades, blend, cor CSS, geometria e foto por oráculo analítico`** — 1,5 d · dep. 4.
   Entra: cenários 5, 7 (resto), 8, 9, 10, 11, 12; `_modo_w3c` movido para `oraculos.py`. Testes: tabela 4.4; os 22 casos de `test_render_blend_pixel.py` seguem verdes.
7. **`test(render): comparadores de áudio e cenários de som`** — 1,5 d · dep. 1.
   Entra: envelope RMS, resíduo/SNR, FFT, início por rajada (adaptados de `HF:packages/producer/src/utils/audioRegression.ts`, com aviso Apache-2.0),
   cenários 13–16 e 18. Testes: determinismo (resíduo 0) e tabela 4.4.
8. **`test(render): título com caixa desfocada no harness`** — 0,5 d · dep. 4. Entra: cenário 17 (N1, `needs_browser`) com `titulos.GeradorTitulos`.
   *Fim do Nível 1 (≈ 8,5 d).*
9. **`test(paridade): página do Program, gancho e acomodação de quadro no navegador headless`** — 2,0 d · dep. 1.
   Entra: `pagina_programa.html`, `gancho.js`, `navegador.py` (lançamento por `titulos.CANAIS`, rota interna, `canPlayType`, acomodação com rVFC,
   captura do `#program-player-viewport`, leitura do canvas do cache). Testes: guarda de ids do `index.html`; cena de 3 quadros com código de
   barras (quadro mostrado = esperado) e *screenshot* de tamanho exato 320×180.
10. **`test(paridade): captura, alinhamento, métricas por família e relatório do player contra o export`** — 1,0 d · dep. 4, 9.
    Entra: leitura do export com matriz de visualizador (709 se altura ≥ 720, senão 601), famílias de limiar, relatório Program \| export \| diferença.
11. **`test(paridade): cenários de vídeo do Program e calibração dos limiares`** — 2,5 d · dep. 5, 6, 9, 10.
    Entra: N2 dos cenários 1, 3–12 e 17. A primeira execução **só mede** e grava `limiares_nivel2.json` (10 execuções); depois liga os limites.
    Testes: `--paridade` verde 10× seguidas; os itens 2, 5 e 6 de 2.6 viram `xfail(strict)` se confirmados.
12. **`test(paridade): áudio do Program contra o export`** — 1,0 d · dep. 7 e a frente de áudio pelo navegador.
    Entra: N2 do cenário 16 e `paridade_audio`; limites 2,1 dB → 0,2 dB e gate ≤ 3 ms.
13. **`docs(render): LEIA-ME do harness, regra do cenário canônico e receita de Docker`** — 0,5 d · dep. 11.

Total 8,5 + 7,0 = **15,5 dias úteis**. As correções (`fix(render): …`, `fix(player): …`) são commits próprios, **depois** do teste em `xfail(strict)` e
com aval; não entram na conta.

---

## 9. Testes e medições

| Medida | Alvo | Como medir |
|---|---|---|
| Tempo do Nível 1 | ≤ 60 s no total, ≤ 5 s por cenário (i7-10700) | `pytest tests/render_regressao -m render_golden --durations=20` **[a medir]** |
| Tempo do Nível 2 | ≤ 10 s por cenário, ≤ 3 min no total | `pytest tests/render_regressao --paridade --durations=20` **[a medir]** |
| Estabilidade do Nível 1 | 0 falhas em 20 execuções seguidas | laço de 20 `pytest` |
| Estabilidade do Nível 2 | 0 falhas em 10 execuções (as da calibração); ≤ 1 repetição de quadro por 100 | contador no `resultado.json` |
| Determinismo | `framemd5` e MD5 de áudio iguais entre duas execuções e entre 1 e 8 *threads* | teste automático (já [medido] igual) |
| Sensibilidade (mutação manual) | ≥ 7 de 8 mutações pegas: `eq` no lugar de `lutrgb`; matriz 601 na leitura; `adelay` +5 ms; sem `tpad`; limitador 0,9; σ do desfoque ×0,8; reverso invertido; `multiply`→`screen` | aplicar cada uma numa cópia de `src/`, rodar o harness, contar falhas |
| Cobertura das regras | cada P1–P8 e cada regra de `nle-parity…` §1–§3 com ≥ 1 cenário | matriz no `LEIA-ME.md` |
| Peso no Git | ≤ 1,5 MB | `git count-objects -vH` antes e depois |
| Métricas contra o ffmpeg | PSNR \|Δ\| ≤ 0,05 dB; SSIM \|Δ\| ≤ 0,02 | teste de validação cruzada |
| Limiares do Nível 2 | pior valor de 10 execuções − margem | `limiares_nivel2.json` |

---

## 10. Critérios de aceite

1. `pytest tests/render_regressao -m "not paridade"` verde na máquina do Fernando (ffmpeg 7.1.4), em ≤ 60 s e sem *skip* inesperado.
2. O cenário canônico existe com 144 quadros, 9 quadros-chave aprovados e bypass exato (`max_abs = 0`); roda também em perfil *deriva* com outro ffmpeg.
3. Cada desvio de 2.6 está coberto por um teste (verde se não ocorre, `xfail(strict)` se ocorre) e a lista dos que **ocorrem** no ffmpeg 7.1.4 foi entregue.
4. Mutação manual: ≥ 7 de 8 mutações são pegas.
5. `aprovar` exige confirmação, grava `APROVADO.json` e `APROVACOES.jsonl`; o pytest nunca escreve em `referencias/` (teste-guarda).
6. `pytest --paridade`: ≥ 10 cenários; família "sem decodificador" ≥ 45 dB; relatório com PNG Program \| export \| diferença; `limiares_nivel2.json`
   calibrado; 0 falhas em 10 execuções.
7. Os testes existentes e os dois canônicos seguem verdes; **nenhuma** mudança em `src/` fora de correções aprovadas.
8. O `LEIA-ME.md` permite acrescentar um cenário em ≤ 15 min (verificado por um chat novo que só o siga).
9. Peso no Git ≤ 1,5 MB; nenhum arquivo > 100 KB versionado.

---

## 11. Riscos e mitigação

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Ruído legítimo Chromium × swscale (crominância, matriz) infla os limiares do Nível 2 | alta | médio | famílias de cenário; luma e blocos 8×8; calibração; `xfail` documentado (4.1, 4.4) |
| Instabilidade de *seek* e decodificação no headless | média | alto | acomodação com rVFC + código de barras, teto de 3 s e 1 repetição; falha com motivo; Nível 2 opt-in |
| Deriva de ffmpeg ou de CPU (SIMD do swscale) | média | médio | perfis estrito/deriva, impressão digital, oráculos que não dependem de aprovação |
| Referência aprovada sem olhar | média | alto | CLI de dois passos mostra PSNR contra a anterior, exige `--motivo`, `APROVACOES.jsonl` no Git; metamórficos e oráculos não aprovam nada |
| Página-harness acoplada ao `index.html` (outra sessão mexe) | média | médio | extração por id + teste-guarda com mensagem clara |
| Chromium do Playwright sem H.264 (Docker, CI) ou Edge ausente/bloqueado | alta fora do Windows | baixo | fonte VP9 por `canPlayType`; `titulos.CANAIS`; `skip` com mensagem |
| O harness acha bugs e cria pressão para corrigir tudo | alta | médio | `xfail(strict)` + lista; correções em commits próprios, com aval; as etapas não esperam |
| Tempo cresce e o Nível 1 deixa de ser rodado | média | médio | 320×180, 3–6 s, `-m "not slow"`, relatório de durações |
| Custo de processo no Windows (ffmpeg ≈ 150 ms) | média | baixo | 1 ffmpeg por render e 1 por extração (*pipe*); métricas em numpy |
| Oráculo copia a fórmula atual do player; se o player mudar, o teste acompanha o erro | média | médio | fórmula num só lugar (`oraculos.ids_esperados`) citando `player.js:4033`; mudar o player muda o oráculo no mesmo commit; pergunta 5 |

---

## 12. Perguntas para o Fernando

1. Versionar no Git, **sem LFS**, as fontes sintéticas (≈ 150 KB) e as referências PNG (≈ 1 MB)? *Recomendo: sim.*
2. Registrar os *markers* no `pytest.ini` e deixar o Nível 2 desligado por padrão (`--paridade`)? *Sim.*
3. Aprovar as referências na sua máquina (ffmpeg 7.1.4 Jellyfin) com perfil estrito e tratar outros ffmpeg como "deriva"? *Sim; Docker só depois.*
4. Os desvios de 2.6: corrigir em chat à parte, um `fix(render)` por desvio depois do `xfail`? *Sim, começando pela contagem de quadros (item 1), a mais simples e visível.*
5. **Reverso:** o certo é começar no quadro `out − 1` (como o export faz hoje, padrão de NLE) ou no quadro do instante `out` (fórmula atual do player)? *`out − 1`: muda o player, não o export; a decisão é sua.*
6. Etiqueta de cor do export HD (`out_color_matrix=bt709` + `-colorspace bt709 …` a partir de 720 de altura): aceita, depois de o cenário 6 confirmar no seu ffmpeg? *Sim.*
7. A página-harness pode extrair o bloco do Program do `index.html` em tempo de teste (teste-guarda de ids), sem gancho `?teste=1` no app? *Sim.*
8. A primeira execução do Nível 2 só mede e grava `limiares_nivel2.json`, sem falhar, até 10 execuções? *Sim.*
9. Incluir `pytest tests/render_regressao -k canonico` na regra `.agents/rules/nle-parity-and-media-lifecycle.md` §3? *Sim.*
10. Tocar também o MP4 exportado no mesmo Chromium (Nível 2b), só para o cenário 6? *Sim, opcional.*
11. CI (GitHub Actions + Docker) agora? *Não; receita no `LEIA-ME.md`.*

---

## 13. Prompt para o chat de implementação

Cole o bloco abaixo num chat novo. Ele manda ler este plano (`docs/plano_hyperframes/B_regressao_render.md`).

````markdown
> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> As etapas 1–5 não dependem de outro chat; a 12 espera a frente de áudio pelo navegador.

---

Vamos criar a regressão do render por imagem e som e o teste de paridade player × export do CapIAu Talho (pasta nova
`tests/render_regressao/`). Hoje os testes de render conferem a string do grafo, fórmulas isoladas e um render de fumaça; ninguém olha o quadro
nem o som do arquivo que `montar_comando` produz, nem compara com o que o Program mostra. Leia antes, nesta ordem, e confira no código o que eu
afirmo (as linhas andam): `docs/plano_hyperframes/B_regressao_render.md` (plano completo, medições e tabelas), `docs/PESQUISA_HYPERFRAMES.md` §4.8,
`.agents/rules/nle-parity-and-media-lifecycle.md`, o cabeçalho de `src/export/video_render/modelo.py` (P1–P8), `comando.py:547-760`,
`midia.py:203-260`, `tests/test_render_blend_pixel.py`, `tests/test_render_in_out_proxies_matte.py:166-230`,
`tests/test_render_titulos.py:124-235`, `src/export/video_render/titulos.py:114-200` e, no player, `player.js:3530-3935`, `4016-4057`, `4624-4800`.

## O que já existe (conferido em 28/10/2026)

- `montar_comando` é pura e roda sem banco: `midia.resolver_fontes(seq, pedido, buscar_midia=…, checar_drive=lambda l: True)`
  (o teste de `…proxies_matte.py:219-226` já faz). O encoder sai de `get_hardware_settings`; no seu i7 o `auto` deve virar QSV: force CPU com `monkeypatch`.
- O Program compõe em DOM + CSS; `STATE`, `TIMELINE_STATE` e `window.player` já são globais; `videoData.src` aceita qualquer URL. `titulos.py:148-200` já
  serve `src/ui` ao Playwright por `page.route` e abre `msedge`/`chrome`: copie o padrão, sem `playwright install`.
- Medido num sandbox (ffmpeg 6.1.1, Linux): o export sai 1 quadro mais curto (`fps=N` final, `comando.py:717`), o reverso difere 1 quadro da fórmula
  do player (`player.js:4033`) e o HD sai sem etiqueta de cor. **Confirme cada um no seu ffmpeg 7.1.4, antes de escrever o teste, e me mostre.**

## Decisões a confirmar comigo antes de começar (recomendação entre parênteses)

1. Fontes sintéticas e referências PNG (≈ 1,2 MB) no Git, sem LFS (sim). 2. Referências aprovadas na minha máquina; outros ffmpeg = perfil "deriva" (sim).
3. Nível 2 desligado por padrão, `--paridade` (sim). 4. Cada desvio achado vira `xfail(strict)` e é corrigido em chat/commit à parte (sim).
5. Reverso: começar em `out − 1` (como o export) ou no instante `out` (fórmula do player)? (`out − 1`; só eu decido). 6. Etiqueta de cor HD no export (sim, após confirmar).
7. Página-harness extrai o bloco do Program do `index.html` em tempo de teste, com teste-guarda de ids (sim).

## O que fazer (um commit por etapa, cada uma testável; os números e cenários estão no plano)

1. `test(render): fontes sintéticas com código de barras e utilitários do harness` (fontes de 11 bits, `ajudantes.py`, markers, teste-guarda da cauda de `comando.py:729-745`).
2. `test(render): contagem de quadros, duração e etiquetas de cor da saída real` (cenários 2 e 6; `ffprobe` do H.264 real).
3. `test(render): oráculo de quadro de origem para corte, trim, velocidade, reverso e freeze` (cenários 3 e 4).
4. `test(render): métricas de imagem, referências aprovadas e relatório de diferença` (`metricas.py`, `referencias.py`, `relatorio.py`, `scripts/render_regressao.py`).
5. `test(render): cenário canônico multipista em cascata com referência aprovada e bypass` (cenário 1; aprovação com você vendo o relatório).
6. `test(render): transições, fades, blend, cor CSS, geometria e foto por oráculo analítico` (cenários 5, 7–12).
7. `test(render): comparadores de áudio e cenários de som` (cenários 13–16 e 18; adaptar `HF:packages/producer/src/utils/audioRegression.ts`).
8. `test(render): título com caixa desfocada no harness` (cenário 17).
9. `test(paridade): página do Program, gancho e acomodação de quadro no navegador headless` (`tests/render_regressao/paridade/`, sem tocar em `src/`).
10. `test(paridade): captura, alinhamento, métricas por família e relatório do player contra o export`.
11. `test(paridade): cenários de vídeo do Program e calibração dos limiares` (primeira execução só mede e grava `limiares_nivel2.json`).
12. `test(paridade): áudio do Program contra o export` (só depois da frente de áudio pelo navegador).
13. `docs(render): LEIA-ME do harness, regra do cenário canônico e receita de Docker`.

Pare ao fim de cada etapa e me diga: o que passou, o que ficou em `xfail`, tempo medido e o que eu preciso decidir.

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev`. Outra sessão mexe na interface (`index.html`, `main.js`, `workspaceManager.js`, `styles.css`): nada disso muda aqui.
  Commit só dos seus arquivos, direto na main, sem coautoria, sem push. Mensagens em português: `test(render): …`, `test(paridade): …`, `docs(render): …`.
- Toda mudança no render ou no player passa nos dois canônicos: `pytest tests/test_render_composicao_multipista_cascata.py` e
  `node tests/autoteste_composicao_multipista_cascata.mjs`, mais `pytest tests/test_render_*.py`.
- Só `tests/render_regressao/`, `scripts/render_regressao.py`, `pytest.ini`, `.gitignore` e, com meu aval, a regra do `.agents`. Correção em `src/` só depois do
  teste em `xfail(strict)`, com meu aval e em commit separado. **Nunca aprove referência sozinho:** mostre o relatório (PNG) e espere o meu "sim".
- Não instale pacotes, não baixe modelos, não suba o servidor do Talho. Nunca escreva em `F:`.
- Código portado do HyperFrames (Apache-2.0): manter "Copyright 2026 HeyGen, Inc.", a licença e a indicação de alteração no cabeçalho.
- Scripts de edição em arquivo, com `PYTHONUTF8=1`. Português, direto. Verifique antes de afirmar; marque [lido], [medido] e [a medir] nos relatórios.
````
