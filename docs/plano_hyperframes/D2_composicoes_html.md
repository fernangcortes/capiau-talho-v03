# Frente D2 — Clipe de composição HTML (motion graphics)

> **Resumo.** Entrega: o clipe "composição animada" na pista de texto (`type:"text"` + objeto `composicao`): página HTML seekável (CSS/WAAPI, sem GSAP) com variáveis, mostrada num iframe no Program e fotografada pelo navegador da D1 no export, com o mesmo palco nos dois; 14 composições portadas do HyperFrames (5 GCs, 3 cartelas, contador, 2 gráficos, mapa com rota, antes/depois, HUD).
> Valor: GC com nome e função ligados à biometria e às entidades, mapa, gráfico, cartela e antes/depois, que o Titler (caixa de texto com keyframes) não faz.
> Esforço: ≈ 31 dias úteis em 3 entregas (corte mínimo E0–E6 ≈ 18 dias); +3 se o HTML do usuário entrar. Estimativas grossas.
> Dependências: D1 etapas 1 a 4 (só para o render); frente B nível 1 (casos `clipe_html_*`). O resto anda em paralelo.
> Principal risco: a chave de deduplicação por animações errar ou o quadro cheio (mapa, gráficos) ficar lento; o texto da licença do GSAP não foi lido em primeira mão (`gsap.com` bloqueado na sessão).
> Decisão principal: portar tudo para CSS/WAAPI (nada de GSAP) e representar a composição como clipe de texto com `composicao`, não como `type` novo.

Convenções: **[lido]** conferido no código; **[inferência]** dedução minha; **[a medir]** precisa de teste prático; **[web: URL]** fonte externa. Caminhos sem prefixo são do Talho (commit `9cba1b2`, 28/10/2026); `HF:` = HyperFrames v0.8.185 (Apache-2.0, lido, nunca executado); `D1:`/`B:` = planos das frentes D1 e B. Nomes novos levam "(novo)". Estimativas de dias são **[inferência; grossas]**.

## 1. Objetivo e valor

**Entrega.** Um tipo de conteúdo novo na pista de texto, a **composição animada**: uma pasta com uma página HTML cuja animação só usa CSS/WAAPI (seekável, sem GSAP), um manifesto com variáveis e fontes locais. O clipe guarda o id da composição e os valores das variáveis. O Program mostra a página num `<iframe>`; o export fotografa **a mesma página** pelo `Navegador` da D1 (PNG com alfa → `ffconcat` → o `overlay` que os títulos já usam). Preview e arquivo usam o mesmo palco (`composicaoPalco.js` (novo)), como `tituloRender.js` já faz com os títulos.

**Valor para um documentário.** O Titler só faz caixa de texto com keyframes (`src/ui/js/textPresets.js:7-120`, 15 presets). Com composições:

| Uso | Exemplo | Ligação com o Talho |
|---|---|---|
| GC de personagem | "Lower third limpo" com `nome` e `funcao` | nome vem de `people`/biometria (`faces.py:657`), função de `entity.role` (`entities.py:28-34`) |
| Lugar e trajeto | mapa-múndi com rota origem → destino | variáveis de latitude/longitude e rótulos |
| Dado | contador, barras, linha | variável `tabela` (linhas editáveis) |
| Cartela | título calmo, "lockup", máquina de escrever | texto e tom |
| Restauração | antes e depois (wipe) | duas fotos do projeto |
| Arquivo | HUD de camcorder (REC, data, contador) | data e contador |

**Fora do escopo desta frente.** Texturas de quadro cheio (grão, light leak, vinheta: ver 3.2 e 5), 3D/WebGL/WebGPU, áudio dentro da composição, editor visual de animação, e HTML do usuário (v2, seção 4.8).

## 2. Estado atual no Talho (arquivo:linha; invariantes)

| Peça | Onde | O que faz e o que implica para D2 |
|---|---|---|
| Camada de texto | `playerTextOverlay.js:65-71`, `86-122` | `div#program-text-layer` (`z-index:40`) dentro de `#program-player-viewport`; `sync()` filtra `c.type === "text"` na pista de texto (101-106) |
| Reconstrução | `playerTextOverlay.js:124-164` | `innerHTML = ""` **a cada** sync; `escala = larguraMonitor / larguraQuadro` (128-133); `montarElementoTitulo` é o mesmo código do export. Um `<iframe>` aqui recarregaria a cada quadro: precisa de camada própria |
| Gatilhos | `playerTextOverlay.js:26-47`; `player.js:2549-2559`, `3617-3619`, `3929-3931` | assina `timelinePlayheadChanged`, `timelineCutsUpdated`, `timelineSelectionChanged`, `previewZoomChanged`, `timelinePropertiesChanged`, `programViewportResized` |
| Relógio do Program | `player.js:3183-3282` | `play(speed)`: laço `requestAnimationFrame` que soma `elapsed*fps*speed` ao `playheadFrame` (velocidade negativa = reverso/J); tudo termina em `setPlayheadFrame` → evento → busca por tempo **absoluto** |
| Monitor | `index.html:1083-1106` | 4 `<video>`, 2 `<img>`, 2 mattes, camada de ajuste e `canvas#program-player-render-cache` (`z-index:45`) dentro de `#program-media-viewport` |
| Render Cache | `player.js:3576-3623`; `renderCache.js` | em cache hit desenha o canvas, esconde o pool e ainda chama `textOverlayManager.sync()` (3617); `renderCache.js` não tem ramo de texto (grep sem ocorrência) |
| Títulos no export | `titulos.py:114-146`, `170-196`, `199-257`, `276-337` | `GeradorTitulos` (um por job, Playwright síncrono); `grupos()` → `[{png, n, mascara, sigma}]`; `preparar_titulos` → `{entradas, camadas, avisos}`, pistas de texto da de baixo para a de cima |
| Contrato com o comando | `comando.py:553-560`, `630-639`, `679`; `execucao.py:424`, `508-531`, `602-603` | `titulos(seq, escopo, ini, fim)`; navegador aberto só se houver título; `fechar()` no `finally` |
| Página fotografada | `render_titulos.html`; `renderTitulos.js:1-112` | `preparar` (fontes, medição), `estados` (chave por quadro, uma chamada), `desenhar`, `mascara` |
| Cache de fotos | `titulos.py:234` | PNG por hash do clipe; sem versão de composição nem identidade do navegador (D1 6.2 acrescenta `assinatura()`) |
| Modelo | `modelo.py:422-431`, `478`, `135` | `type "text"` vira `kind="text"` e **só ele** guarda `bruto`; type desconhecido cai no `else` (mídia) e vira vídeo se estiver em pista de vídeo |
| Forma do clipe de texto | `textPresets.js:424-463` | `type:"text"`, `text`, `subtext`, `fontFamily`, `keyframes`, `track`, `inFrame/outFrame`, `timeline_start` |
| Preflight | `fidelidade.py:35`, `192-209`, `211-224`, `226-249` | pista de kind desconhecido avisa; `TITULOS_SEM_NAVEGADOR` conta `c.tipo == "text"`; `EFEITO_TIPO_DESCONHECIDO` só olha `effects` |
| Exports | `otio_export.py:143-209`; `subtitles_export.py:50,83,136`; `narrative.py:529-531` | text → `GeneratorReference("Title")` + `metadata.capiau`; **todo** `type == "text"` vira legenda SRT/VTT/ASS; formatos `otio|xml|edl` |
| Servidor | `server.py:67-68`, `175` | CORS `allow_origins=["*"]`, UI estática em `/` sem CSP |

**Invariantes que D2 não pode quebrar**

1. Mesmo código no preview e no arquivo (`titulos.py:7-10`): o palco da composição é um módulo único, importado pelo Program e pela página de render.
2. Regras P1 a P8 (`modelo.py:17-37`) e o cenário canônico multipista em cascata (`pytest tests/test_render_composicao_multipista_cascata.py`; `node tests/autoteste_composicao_multipista_cascata.mjs`) verdes em toda etapa que toque `titulos.py`, `execucao.py`, `comando.py`, `modelo.py` ou o player.
3. Sem navegador o render sai sem títulos **e avisa** (`execucao.py:521-522`; `fidelidade.py:211-224`); vale para composições. Preflight não lança processo.
4. Nada baixa sozinho; fontes do projeto por `FontFace` com aviso `fonteDisponivel`; render **sem rede**.
5. GPLv3: GSAP não entra no repositório; código do HF entra com cabeçalho Apache-2.0 e indicação de alteração.
6. Buffers e VRAM (`.agents/rules/nle-parity-and-media-lifecycle.md` §2): nunca destruir o `<iframe>` que está no ar; liberar os fora do ar; sem `ImageBitmap` novo.
7. Nada de UI antes do render: o que aparece na tela tem de sair no arquivo (a UI de composições só liga quando a Etapa 3 passa).

## 3. O que o HyperFrames tem (portar / adaptar / inspirar-se)

### 3.1 Peças e veredito

| Peça (HF:packages/core/src/runtime ou citada) | Linhas | Veredito | Nota |
|---|---:|---|---|
| `protocol.ts` | 107 | **Inspirar-se** | versão de protocolo + capacidades (1-12), `playRangeHoldTime` (53-55), `frameDisplayScale` (73-77). No Talho basta `capiau:1` em cada mensagem e `protocolo` no manifesto |
| `adapters/css.ts` | 235 | **Adaptar** (reescrever, ~60 linhas) | acha animações por `getAnimations()` (30-43), segura cada uma em `currentTime` (191-211) e, se não há `CSSAnimation` viva (`display:none`), usa `animation-delay` negativo (206-210). Depende de `RuntimeDeterministicAdapter`, `swallow`, `domRealm` e da árvore `data-start`: não é cópia |
| `adapters/waapi.ts` | 233 | **Adaptar** (~50 linhas) | gancho em `Element.prototype.animate` (94-121) + linha de base por animação (56-70); comentário medido: `document.getAnimations()` "é surpreendentemente caro" (157-160) |
| `adapters/_holdAnimationAt.ts` | 29 | **Portar quase literal** | `pause()` antes de `currentTime`, com `pause()` de novo se falhou (10-28) |
| `adapters/seek-dispatch.ts` | 159 | **Inspirar-se** | evento `hf-seek` com `waitUntil` (33-54) e barreira de conclusão; aqui vira `aoBuscar(t)` + `Promise` de prontidão. O dedupe dele é por tempo (80-84), o nosso é por estado |
| `adapters/lottie.ts` | 317 | **Não usar na v1** | nenhuma das 49 candidatas usa Lottie (`cat.json`, campo `lottie`) |
| `applyVariableBindings.ts` | 195 | **Portar** (~60 linhas) | `data-var-text` (189-194), `data-var-src` só em `img/video/audio/source` (42, 148-167) com `isSafeMediaUrl`, `--id` na raiz com `sanitizeCssValue` (67-69, 136-146) |
| `getVariables.ts`, `variables.ts` | 323, 35 | **Inspirar-se** | defaults declarados + sobrescritas (`window.__hfVariables`, 317-323); aqui a sobrescrita é o `composicao.variaveis` do clipe, enviada por `postMessage` |
| `HF:packages/parsers/src/compositionVariables.ts` | 106 | **Portar** (JS e Python) | tipos `string/number/color/boolean/enum/font/image` (15-23), `isCompositionVariable` (49-56), `isSafeMediaUrl` (94-106). Estender com `tabela` |
| `HF:packages/player` | ~7 mil | **Inspirar-se** | `sandbox-origin` tira `allow-same-origin` do iframe (`hyperframes-player.ts:46,373-379`), `srcdoc` (239), `postMessage` (831) |
| `HF:packages/studio/AGENTS.md:9-22` | | **Inspirar-se** | o "chrome" de edição (caixa, alças) vive **fora** do iframe e mede o elemento |
| Catálogo `registry/` | 49 candidatas | **Portar 14** | seção 4.2 |
| GSAP 3.14.2 | | **Não embutir** | `HF:CREDITS.md:44-46` ("not an OSI open-source licence") |

### 3.2 Erros e omissões em `docs/PESQUISA_HYPERFRAMES.md` §4.3 (e nas varreduras)

1. **`heatmap` não é gráfico.** Está em "Dados", mas é um shader WebGPU decorativo de 32 linhas (`HF:registry/blocks/heatmap/heatmap.html:23,27,29`: `data-requires-webgpu`, `lib/shaders.iife.js`). Fora.
2. **`nyc-paris-flight` não serve de "rota de voo" genérica.** É uma ilustração Nova York → Paris com efeitos sonoros e mídia própria (descrição do `registry-item.json`). A rota genérica nasce do `world-map`.
3. **"Textura de arquivo" (grão, light leak, vinheta, warm-grain) é o pior caso para o nosso export:** quadro cheio, contínuo, com alfa. A D1 estima 0,4 a 1,6 s por quadro cheio em PNG (`D1:4.5`) e o `light-leak` usa WebGL (`light-leak.html:203`). Fora da v1; a saída é gerar vídeo opaco com modo de mesclagem (seção 5, DP12).
4. **"Variáveis ligam direto" vale para 2 dos 13 lower thirds** (`lt-neon-border`, `lower-third-bild` declaram variáveis). Os outros 11 trazem o texto fixo no HTML (`lt-clean-bar.html:77-78`); cada porte precisa de `data-var-text`.
5. **A CDN não é só GSAP:** o mapa também baixa d3 7, topojson-client e `world-atlas@2/countries-110m.json` em tempo de execução (`world-map.html:13-15,281`), além das fontes do Google. Render sem rede exige vendorizar tudo.
6. **"Basta generalizar `RENDER_TITULOS.desenhar(clip, t)`" subestima:** faltam isolamento da página, escala, prontidão assíncrona (fontes, dados), chave de deduplicação e versão da composição na chave de cache.
7. **Deduplicação:** o §4.3 aponta hash/`hasDamage`. A D1 já corrigiu (`D1:3.2` itens 4 e 5): `hasDamage` não vale no Windows nem com alfa; a chave vem de `document.getAnimations()` (aqui, seção 4.6).
8. **Dependência:** o §7 diz que D2 depende de "captura rápida"; depende só do módulo comum da D1 (etapas 1 a 4; `D1:3.2` item 7).
9. **"1920×1080 fixo":** 47 das 49 candidatas; `organic-light-leak-overlay` é 960×540 e `notes-reveal` é 1080×1920 (`cat.json`).
10. **"~230 linhas cada"** confere (`css.ts` 235, `waapi.ts` 233), mas os adaptadores dependem de tipos e utilitários do runtime do HF: é reescrita guiada, não cópia.
11. **Falsos positivos e pontos cegos da varredura (`ana/scan.py`):** `split-flap-board` aparece com o plugin `Flip` do GSAP, mas a única ocorrência é um comentário (`split-flap-board.html:141`); nenhuma das 49 usa plugin (`grep registerPlugin` só acha outras peças). A varredura lê só `.html`, então não vê `lib/*.js`, imagens e áudio das pastas (o `heatmap` e o `nyc-paris-flight` escapam). Conferido por amostragem em 6 arquivos: `lt-clean-bar`, `world-map`, `split-flap-board`, `light-leak`, `heatmap`, `count-up`/`typewriter` (variáveis).
12. **Boa notícia que a pesquisa não registrou:** em 49 candidatas há **zero** `Math.random`, `Date.now`, `performance.now`, `requestAnimationFrame`, `setInterval`/`setTimeout` e `registerPlugin` (minha varredura dos HTML das 49). Todas são funções puras do tempo da linha do tempo do GSAP, o que torna o porte e a deduplicação seguros.

## 4. Verificações de viabilidade

### 4.1 Program monitor: como os títulos são compostos hoje e onde entra o iframe

**Veredito: viável, com camada própria e iframes persistentes. Não dá para reaproveitar a camada de texto.**

- **Hoje [lido]:** DOM sobre `<video>`, não canvas. Títulos são `div`s em `#program-text-layer` (`z-index:40`), refeitos a cada `sync()` (`playerTextOverlay.js:126`). Vídeo, foto, matte e ajuste vivem em `#program-media-viewport`; o `canvas#program-player-render-cache` (`z-index:45`) só aparece em cache hit e não tem texto (`player.js:3576-3623`).
- **Onde entra:** `#program-composicoes-layer` (novo, `z-index:39`, irmão da camada de texto) gerida por `PlayerComposicoes` (`playerComposicoes.js` (novo)). Ela assina os mesmos eventos de `playerTextOverlay.js:26-47`, calcula os clipes de composição ativos (`type:"text"` com `composicao`, pista ligada, quadro dentro da janela) e **reconcilia** com os iframes vivos (criar, mostrar, esconder, destruir); nunca zera o conteúdo. `PlayerTextOverlayManager.sync` passa a ignorar clipes com `composicao` (filtro em `playerTextOverlay.js:101-106`). Regra Z1: composição fica **abaixo** de texto; entre composições vale a ordem das pistas.
- **Busca por tempo absoluto:** `t = tempoDaComposicao((quadro - timelineStartFrame)/fps)` (regiões protegidas, seção 6.2) enviado por `postMessage({capiau:1, tipo:"buscar", t, id})`, no máximo **um por iframe por `requestAnimationFrame`** (só vale o último). Como a busca não tem estado, **scrubbing, J/K/L até 16x, reverso (`playbackSpeed < 0`, `player.js` laço de `play()`), loop e pausa** funcionam sem código extra; pausado, nada roda dentro do iframe. Dentro dele, o runtime (`capiau-comp.js`, seção 5) põe todas as animações em `currentTime = t`.
- **Quantos iframes:** até 2 no ar (duas pistas de texto) + 2 pré-aquecidos (clipe que começa em até 3 s); teto 4. Nunca destruir o que está no ar; remover primeiro o mais antigo fora do ar. Excedente mostra "Pré-visualização limitada" (o export desenha todos). Carga e memória por iframe: LT e mapa **[a medir]**.
- **Render Cache:** composições ficam **fora** do cache (DOM acima do canvas), e `renderCache.js` não precisa mudar. Dois pontos **[a medir]**: (i) o canvas tem `z-index:45` e a camada de texto 40; se estiverem no mesmo contexto de empilhamento o canvas cobre texto e composição em cache hit, e a correção é de CSS para os dois; (ii) se `timelineCutsUpdated` (disparado ao editar uma variável) invalida trechos do cache à toa (`invalidateRange`), filtrar por `kind`.
- **Escala e posição:** o iframe tem o tamanho do palco do manifesto (1920×1080) e recebe `transform: scale(k)` com `transform-origin: 0 0`; `k` e a âncora saem de `composicaoPalco.js` (novo), o mesmo módulo que a página de render usa. `programViewportResized` e `previewZoomChanged` recalculam (como o título, `playerTextOverlay.js:128-133`).
- **Interação:** v1 sem arrastar nem alças no monitor (a composição ocupa o quadro); seleção pela timeline e edição no inspetor. Se um dia houver caixa de seleção, vive **fora** do iframe (`HF:packages/studio/AGENTS.md:9-22`).

### 4.2 Candidatos: dependências, fontes, rede, variáveis, esforço de porte

Fonte: `ana/cat.json` e `ana/lt.json` (49 itens, varredura automática) + 6 arquivos abertos (3.2 item 11). P = ≤ 0,5 dia, M = 1 a 1,5, G = 3, por composição já com teste e referência. **Os 15 primeiros** (14 + 1 opcional), por utilidade em documentário e custo:

| # | Composição (origem HF) | Lin./tweens | Dependências | Fontes | Variáveis no Talho | Porte | Dias |
|---|---|---|---|---|---|---|---:|
| 1 | `lt-clean-bar` | 112 / 10 | GSAP (CDN) | Montserrat | `nome`, `funcao`, `cor_destaque` | P | 0,3 |
| 2 | `lt-side-rule` | 114 / 10 | GSAP | JetBrains Mono, League Gothic | `nome`, `funcao`, `cor` | P | 0,3 |
| 3 | `lt-kicker-name` | 114 / 10 | GSAP | Archivo Black, Space Mono | `kicker`, `nome` | P | 0,3 |
| 4 | `lt-dark-card` | 111 / 10 | GSAP | Montserrat | `nome`, `funcao` | P | 0,3 |
| 5 | `lt-mask-reveal` | 120 / 11 | GSAP (clip-path) | Montserrat | `nome`, `funcao` | P | 0,4 |
| 6 | `titlecard-calm` | 277 / 5 | GSAP | grotesca + mono (tokens `--font-*`) | `headline`, `kicker` (já declaradas) | P | 0,5 |
| 7 | `titlecard-lockup` | 405 / 6 | GSAP, 1 SVG | Inter + mono | idem | P–M | 0,7 |
| 8 | `typewriter` | 306 / 5 | GSAP, revelação por caractere em JS | Inter | `text`, `tone`, `caret` | M | 1 |
| 9 | `count-up` | 400 / 12 | GSAP | Inter | `start`, `end`, `prefix`, `suffix`, `accent`, `glow`, `exit` | P–M | 0,7 |
| 10 | `animated-bar-chart` | 276 / 3 | GSAP, 1 SVG | Inter | **`tabela`** (hoje dados fixos) | M | 1,5 |
| 11 | `mk-line-graph` | 293 / 13 | GSAP, 1 SVG | `--mk-font` | **`tabela`** (2 séries) | M | 1,5 |
| 12 | `mapa_rota` (novo, de `world-map`) | 436 / 7 | GSAP + d3 7 + topojson + `world-atlas` por CDN | Inter | origem/destino (lat, lon, rótulo), estilo | G | 3 |
| 13 | `before-after-wipe` | 562 / 7 | GSAP | Inter | `label_a`, `label_b`, `rest_split`, `wipe_at`, 2 × `image` | M | 1,2 |
| 14 | `camcorder-hud` | 238 / 2 | GSAP | monospace | `data`, `hora` (contador em `aoBuscar`) | P | 0,5 |
| 15 | `news-ticker` (opcional) | 409 / 16 | GSAP | Inter | `rotulo`, `manchete` | M | 1 |

Total das 14: **≈ 12 dias** de porte. Rede no render: GSAP em todas (some com o porte), fontes do Google em todas (vendorizar ≈ 8 famílias OFL, ~1 MB), mapa com d3-geo + topojson + dados (vendorizar, ISC). Nenhuma usa plugin de GSAP, `Math.random`, `Date.now` ou `requestAnimationFrame`. **[inferência]** `typewriter`, `count-up` e `camcorder-hud` escrevem texto por JS (`textContent`); no porte o texto vira função pura do tempo (`aoBuscar(t)` + `estado(t)`, seção 5, DP6). Nenhuma das 14 usa three.js, Lottie, canvas, WebGL/WebGPU nem tiles de mapa (`cat.json`: `three`, `lottie`, `canvas`, `webgl`, `maplibre` falsos; só `light-leak` e `heatmap` usam, e ficam fora); o mapa desenha topojson em SVG com d3. Vale portar as 14; as demais, não agora, pelos motivos abaixo. Quanto a efeitos de CSS: `backdrop-filter` só aparece no `world-map` (1 uso, sem efeito dentro de iframe: o lint avisa).

**Fora da v1, e por quê:** mapas de país (`spain-map`, `us-map*`, `us-map-hex`) e `nyc-paris-flight` (específicos); gráficos de matéria (`data-chart`, `nyt-graph`, `bar-chart-race`, `chart-story`: 12 a 25 tweens, Google Fonts, sem variáveis; segunda leva); `heatmap` (WebGPU); texturas (`grain-*`, `light-leak`, `organic-light-leak-overlay`, `vignette`, `warm-grain`); `notes-reveal` (1080×1920, 1662 linhas, peça autoral); `freeze-frame-dressing` (pede recorte do sujeito); `split-flap-board` (bom para datas e lugares, M; segunda leva); outros 8 GCs (`lt-stack-bars`, `lt-accent-underline`, `lt-bold-block`, `lt-color-block`, `lt-soft-pill`, `lt-neon-border`, `lower-third-bild`, `yt-lower-third`; cinco deles custam ≈ 1,5 dia).

### 4.3 Licença do GSAP

**Limite desta leitura: não li o texto da "GSAP Standard License".** `gsap.com` e o espelho `scancode-licensedb.aboutcode.org` não resolvem na rede desta sessão (`ENOTFOUND`), `raw.githubusercontent.com/greensock/GSAP` devolveu 404 e o repositório `greensock/GSAP` não está liberado para a sessão. Para eu ler o texto, é preciso liberar `gsap.com` nas configurações de rede. O resumo abaixo vem de fontes secundárias e **não é parecer jurídico**:

- **[lido]** `HF:CREDITS.md:44-46`: "GSAP Standard License … (not an OSI open-source licence)". O `gsap-3.14.2.min.js` vendorizado pelo HF abre com "@license Copyright 2025, GreenSock. All rights reserved. Subject to the terms at https://gsap.com/standard-license" (`HF:registry/blocks/frost-sequence-camera-orbit/assets/gsap-3.14.2.min.js:1-8`) e o `GSAP-NOTICE.txt` diz "Used under the GSAP Standard License".
- **[web: https://registry.npmjs.org/gsap/3.14.2]** campo `license`: "Standard 'no charge' license: https://gsap.com/standard-license."; o README do pacote diz que o GSAP é "100% FREE including ALL of the bonus plugins … even for commercial use". O tarball 3.14.2 **não traz arquivo de licença**: o texto vive só na URL.
- **[web: https://webflow.com/blog/gsap-becomes-free; https://tostracker.app/document/gsap; https://open.windriver.com/info/uni-license-list/licenses/gsap-standard-no-charge-2025.html]** resumo da busca: uso comercial liberado; **proibido** usar o GSAP em ferramenta que deixe o usuário criar animações visuais sem código e ajude solução concorrente do produto visual da Webflow, fazer engenharia reversa para produto concorrente e remover avisos; a Webflow pode rescindir e alterar os termos (uso continuado = aceite); código gerado por IA não é "uso proibido".
- **Não confirmado:** o que a licença diz sobre redistribuir o GSAP **dentro** de outro software, e sobre software GPL. Pela GPLv3 §10, o Talho não pode impor ao destinatário restrições além da GPL; uma licença não-OSI com cláusula de rescisão e de usos proibidos, embutida na mesma página, é exatamente o caso que a FSF trata como incompatível **[inferência]**.

**Conclusão: portar para CSS/WAAPI.** Razões: (1) o GSAP não pode ir no repositório nem no instalador de uma aplicação GPLv3; (2) os blocos do HF o carregam por CDN, o que o render sem rede proíbe; (3) o porte é pequeno para as 14 escolhidas (≤ 13 tweens, sem plugin). **"GSAP como download opcional do usuário" fica só para a v2 (HTML do usuário):** o Talho não distribui, o lint avisa "GSAP detectado, licença não-OSI, a cópia é do usuário". Como caminho principal ele duplicaria o motor de animação, exigiria rede e deixaria o Talho oferecendo um download de terceiro com termos que não pode checar. Quem decidir redistribuir algo do GSAP deve reler o texto em gsap.com antes.

### 4.4 Variáveis: formato, inspetor e ligação com dados do Talho

**Formato do HF [lido]:** array JSON em `data-composition-variables` na `<html>`, cada item `{id, type, label, default, …}` com tipos `string, number, color, boolean, enum, font, image` (`compositionVariables.ts:15-23`), `options[]` obrigatório no enum (54) e extras como `maxLength`, `min/max/step/unit` (`split-flap-board.html:4-10`). Valores = defaults + sobrescritas em `window.__hfVariables` (`getVariables.ts:4-16,317-323`). Consumo sem script: `data-var-text`, `data-var-src` (só mídia, URL segura) e `--id` na raiz, com `sanitizeCssValue` tirando `; { } < >` e quebras de linha contra injeção de declaração (`applyVariableBindings.ts:67-69,136-146`).

**No Talho:** o mesmo esquema num `composicao.json` ao lado do HTML (Python e JS leem sem abrir navegador; o preflight valida), mais o tipo `tabela` (`colunas[]`, `min_linhas`, `max_linhas`) e o campo `ajuda`. O HTML só usa `data-var-text`, `data-var-src`, `--id` e `aoBuscar(t)` (texto calculado). `capiau-comp.js` porta o `applyVariableBindings` e recebe os valores por `postMessage` (`iniciar`, `vars`). Valor inválido (tipo errado, enum fora de `options`, número fora de `min/max`) cai no default com aviso; nunca quebra o render.

**Inspetor gerado do manifesto** (`composicoesUI.js` (novo), no ramo de `timelineInteraction.js:8078` que hoje trata `isText`): `string` → campo com `maxLength` e contador; `number` → controle deslizante + campo (`unit`); `color` → seletor + hex; `boolean` → interruptor; `enum` → lista; `font` → fontes da biblioteca + do projeto (`fontes_projeto.py`); `image` → foto do projeto (grava `photo_id` e a URL da API); `tabela` → grade editável com colar de CSV. Edição ao vivo com atraso de 120 ms → `postMessage vars`; confirmar grava no clipe com `TIMELINE_HISTORY` (desfazer).

**Ligação com biometria e entidades.** Nome: `GET …/project/{id}/people` (`faces.py:657`, `PersonResponse.name`) e `GET …/video/{video_id}/faces` (`faces.py:1270`) para o rosto do plano. Função: `entity.role` (`entities.py:28-34`; lista em `entities.py:35`). A relação **pessoa ↔ entidade `person`** (mesmo nome? `linked_entity_id`, `schema.py:979-981`?) é **[a confirmar no código antes da Etapa 5]**. Mecanismo: em variáveis `string` o inspetor oferece "ligar a…"; `ligacoes` guarda a origem (`{fonte:"pessoa", id}`, `{fonte:"entidade", id, campo:"role"}`) e o valor resolvido é **copiado** para `variaveis` (instantâneo). O render lê só `variaveis`: determinístico, sem consultar o banco. "Atualizar dos dados" refaz a cópia mostrando as diferenças (`POST /api/composicoes/resolver` (novo), em lote). Atalho v1.1: "Criar GC para <nome>" a partir do rosto identificado no plano. Os 4 GCs de `textPresets.js:7-120` continuam; `text`/`subtext` do clipe espelham `nome`/`funcao` (fallback, 6.3).

### 4.5 Escala para sequências que não são 1920x1080

- O manifesto declara o palco (`largura×altura`, padrão 1920×1080), `ajuste` (`caber` padrão, `cobrir`) e `ancora` (`cheio`, `centro`, `base-esquerda`, `base-centro`, `topo`). Com sequência `W×H`: `k = min(W/Lc, H/Ac)` (`caber`) ou `max` (`cobrir`).
- **Preview:** `transform: scale(k · escalaDoMonitor)`. **Export:** viewport `W×H` e o **mesmo `k`** no elemento do palco, **sem `will-change`**, para o Chromium rasterizar no tamanho final (vetor nítido em 720p e 4K, não bitmap ampliado) **[a medir: comparar com `deviceScaleFactor`]**. Os dois caminhos passam por `composicaoPalco.js`.
- 16:9 em 720p, 1080p e 4K: `k = W/1920`, âncora cheia, sem barras. 4K custa ≈ 4x por foto (PNG): o preflight estima o tempo.
- 9:16 (1080×1920) e 1:1: uma composição 16:9 em `caber` ocupa 1080×608 (k = 0,5625); LT ancorado embaixo fica pequeno. Aviso `COMPOSICAO_PROPORCAO` (info). O manifesto reserva `variantes: {"vertical": "index_vertical.html"}` (escolha por razão de aspecto); a v1 só valida a chave. `notes-reveal` (1080×1920) mostra que o HF resolve assim.
- Caso de regressão `clipe_html_escala` (seção 9).

### 4.6 Render: deduplicação, custo por quadro, rede bloqueada, fontes offline

- **Chave por animações.** Depois de `buscar(t)`, a chave é o JSON de: `progress` e `currentIteration` de `effect.getComputedTiming()` de cada animação conhecida (lista fixada no `discover`, como `entries` do HF, para as terminadas com `fill:none` não sumirem), o estado do palco (transform/opacidade do clipe) e `CapiauComp.estado(t)` quando existir (string pura). Mesma chave ⇒ mesma foto, se a página só muda por animações e por `estado`. Garantia: lint + teste de solidez (seção 9). Todas as chaves da janela saem de **uma** chamada `avaliar` (laço em JS, sem ida e volta por quadro, como `estados` em `renderTitulos.js`) e vão em `PedidoQuadro.chave` (`dedupe="chave"`, D1 7.1).
- **Reserva:** `dinamica:"js"` sem `estado()` ⇒ `dedupe="hash"` (a foto é paga; só reduz arquivos). `hasDamage` não vale (D1 3.2). O `getAnimations()` custa caro (`waapi.ts:157-160`), mas fora do laço de captura.
- **Ganho:** `lt-clean-bar` anima em 0,1–0,94 s e 4,3–4,65 s (`lt-clean-bar.html:99-106`): ≈ 40 estados em 144 quadros, 3,6x menos fotos; com regiões protegidas e clipe longo o meio vira 1 foto. Mapa de 12 s: quase todos os quadros diferem (sem ganho).
- **Custo por quadro [inferência sobre D1 4.5; a medir]:** busca + chave 1 a 5 ms; foto PNG 1080p com alfa esparsa 40 a 120 ms; quadro cheio 0,3 s (PNG nível 1) a 1,6 s (nível 6). LT 4,8 s ≈ 40 × 0,1 = **4 s**; contador 3 s ≈ 9 s; mapa 12 s ≈ 360 × 0,5 = **3 min**. Composição `alfa:false` (mapa em tela cheia) usa JPEG q95 (6 ms contra 301 ms de PNG nível 1 em `D1:4.5`, 50 a 230x) e sobrepõe sem alfa; paridade com o preview (croma 4:2:0) **[a medir]**.
- **Rede bloqueada, em 3 camadas:** (1) a biblioteca não tem URL externa (`tests/test_composicoes_biblioteca.py` varre `https?://` fora de comentários e namespaces); (2) página servida pelo `ServidorLocal` da D1 com CSP `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; sandbox allow-scripts` **[inferência: CSP3]**; (3) `route` aborta o que sai do prefixo da composição e grava a URL → aviso `COMPOSICAO_REDE_BLOQUEADA` (o render continua).
- **Fontes offline:** `@font-face` com `url(../fontes/x.woff2)`; `preparar()` espera `document.fonts.load` e `ready` e confere pela mesma medição de `_fonteEmUso` (`renderTitulos.js`); fonte do projeto entra pelo mapa `fontes` do servidor (D1 `publicar_mapa`) e pela rotina `FontFace` que `renderTitulos.js` já tem. `src/ui/fonts/` traz Inter, Outfit, Barlow Semi Condensed, IBM Plex Sans Condensed e Roboto Flex; faltam Montserrat, League Gothic, JetBrains Mono, Archivo Black, Space Mono e as das cartelas: ≈ 8 famílias OFL, subconjunto latino, **~1 MB [a medir]**, com o texto OFL.
- **Cache:** `base = hash(clipe, L, A, hash dos arquivos da composição, versão do runtime, navegador.assinatura())` (D1 6.2): editar o HTML da biblioteca invalida as fotos.

### 4.7 Export OTIO/XML/EDL

**Recomendo os dois, com padrão por formato.** (1) `GeneratorReference` (`generator_kind="CapiauComposicao"`, `composicao_id` + `variaveis`) **sempre**, com `metadata.capiau = {type:"text", composicao:{…}}`: ida e volta no Talho (`otio_import.py:341-360` lê `metadata.capiau`). Em outro editor perde a animação (EDL nem tem gerador; o XML trata gerador de forma desigual **[inferência]**). (2) Opção "Incluir composições como vídeo com alfa": cada clipe vira `<projeto>_composicoes/<id>.mov` (ProRes 4444: `prores_ks`, `yuva444p10le`) a partir do mesmo `ffconcat` de PNG do render, e a trilha referencia o arquivo (`ExternalReference`). **Padrão ligado em `xml` e `edl`** (senão a composição some em silêncio no Resolve/Premiere), **desligado em `otio`**, com aviso "N composições viram gerador sem animação". ProRes 4444 de 5 s a 1080p30 pode passar de 100 MB **[a medir]**; `qtrle` ou sequência PNG para gráficos chapados; avisar espaço em disco. Precisa de `prores_ks` no ffmpeg do Fernando **[a confirmar]**. `subtitles_export.py:50,83,136` passa a ignorar clipes com `composicao`.

### 4.8 HTML do próprio usuário

**Recomendo v2, não v1.** A v1 só abre a biblioteca curada. O risco é real: um `<iframe>` na mesma origem do app lê `localStorage` e chama `/api/*` (apagar projetos), e `CORSMiddleware(allow_origins=["*"])` (`server.py:67-68`) deixa até uma página de origem opaca ler a API local: só `sandbox` não basta. Defesa em camadas para a v2 (e já na v1, para a biblioteca): (1) `/composicoes/` servido por uma subclasse de `StaticFiles` montada **antes** de `server.py:175`, com `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; …; connect-src 'none'`, o que dá origem opaca até em navegação direta; (2) `<iframe sandbox="allow-scripts">` **sem** `allow-same-origin` (o `sandbox-origin` do HF faz o inverso, `hyperframes-player.ts:373-379`); (3) só `postMessage`, validando `event.source` e o formato; (4) no render, página por token (D1) e `route` bloqueando o resto; (5) aviso de confiança na importação ("este HTML é código") e lint estático (rede, `eval`, GSAP, `requestAnimationFrame`, `Math.random`, `Date.now`). Arquivos do usuário ficam em `data/composicoes/<projeto>/<id>/` (como `fontes_projeto.py`), `origem:"projeto"`, com o mesmo manifesto.

## 5. Decisões de projeto (alternativas e recomendação)

| # | Decisão | Alternativas | Recomendação e motivo |
|---|---|---|---|
| DP1 | Representação do clipe | (A) `type:"html"`; (B) `type:"text"` + objeto `composicao`; (C) kind de pista novo | **B.** `bruto` já guarda o clipe cru para `text` (`modelo.py:478`) e `type` desconhecido vira vídeo (`modelo.py:422-431`); `fidelidade.py:211-224` já cobre o navegador; A tocaria ≈ 9 arquivos de UI que testam `type === "text"` (`timelineState.js` ×4, `playerTextOverlay.js` ×2, `textAIEngine.js` ×2, `timelineRenderer`, `timelineInteraction`, `panels`, `player`, `creditsNormalizer`, `fontCatalogModal`) e o modelo (≈ +2 dias, mais risco). Timeline nova no Talho antigo abre como título com nome e função. Custo de B: filtrar `composicao` em `playerTextOverlay.js:101` e `subtitles_export.py` |
| DP2 | Contrato de autoria | GSAP (como o HF); CSS/WAAPI pausado + manifesto; Lottie | **CSS/WAAPI.** 4.3. Canais independentes de transformação por `@property --x/--y/--s/--r` + `translate/scale/rotate` (mesma ordem do GSAP); `anima.js` (~50 linhas) só para composições de dados e mapa |
| DP3 | Preview | `<iframe>` por clipe; imagem renderizada no servidor; DOM direto no app | **iframe persistente:** isola CSS e script, é a mesma página do export, busca por tempo sem recarregar |
| DP4 | Palco | `composicaoPalco.js` único; dois códigos | **Único** (iframe, escala, âncora, regiões, mensagens), importado por `playerComposicoes.js` e `renderComposicoes.js` |
| DP5 | Transporte | `postMessage`; chamada direta (mesma origem) | **`postMessage`:** único caminho com sandbox; ~0,1 a 0,3 ms **[a medir]** |
| DP6 | Deduplicação | chave por animações + `estado()`; hash do PNG; nenhuma | **Chave**, com hash de reserva (4.6) |
| DP7 | Alfa | PNG com alfa; JPEG opaco; vídeo com alfa | **Por composição** (`alfa` no manifesto): GC com alfa, mapa e cartela cheia opacos |
| DP8 | Variáveis | esquema do HF + `tabela`; JSON livre | **Esquema do HF** (já validado, com `isSafeMediaUrl` e `sanitizeCssValue`) + `tabela` |
| DP9 | Dados do Talho | instantâneo + "Atualizar"; ligação viva | **Instantâneo:** render determinístico, sem banco em tempo de render |
| DP10 | Duração | regiões protegidas; cortar; esticar tudo | **Regiões** (6.2): entrada no começo, saída ancorada no fim, meio parado; sem regiões segura o último estado |
| DP11 | Escala | palco fixo + `k` e âncora; reflow responsivo | **Palco fixo** + `variantes` por proporção (4.5) |
| DP12 | Texturas | fora da v1; PNG com alfa quadro a quadro; vídeo opaco + `blend_mode` | **Fora da v1.** v2: renderizar uma vez em fundo opaco e compor com o `blend_mode` que `modelo.py` já entende (`screen`, `overlay`) |
| DP13 | Empilhamento | composição abaixo de texto (Z1); por pista | **Z1:** simples e igual nos dois lados; `preparar_titulos` emite as camadas de composição antes das de texto |
| DP14 | Biblioteca | `src/ui/composicoes/` no repositório; catálogo baixado | **No repositório:** offline, versionada, sem "baixar sozinho". Nome na tela: "Composição" |
| DP15 | Transformação do clipe | v1 sem; reutilizar `evaluateClipTransform` no palco | **v1 sem; v1.1 com** (posX/posY/scale/opacidade entram na chave) |

**Runtime mínimo dentro da página (`capiau-comp.js` (novo), ≈ 150 linhas, cabeçalho "Adaptado de HyperFrames, Apache-2.0")**

```jsonc
// pai → iframe: {capiau:1, tipo:"iniciar", variaveis}  {tipo:"vars", variaveis}  {tipo:"buscar", t, id}
// iframe → pai: {capiau:1, tipo:"pronto", duracao_s}  {tipo:"buscado", id, chave}  {tipo:"erro", msg}  {tipo:"rede_bloqueada", url}
window.CapiauComp = { protocolo: 1, aoBuscar: null /* (t)=>void, função pura do tempo */, estado: null /* (t)=>string */, pronto: Promise }
// buscar(t): para cada animação (getAnimations() + as criadas por Element.animate): pause() e depois currentTime = t*1000
//            (_holdAnimationAt.ts:10-28); chama aoBuscar(t); chave = progresso de cada animação + estado(t)
```

## 6. Modelo de dados e compatibilidade

### 6.1 Clipe no `sequence_json` v2 (sem mudar `version`)

```jsonc
{ "id": "txt_1761600000_ab12", "type": "text", "track": "T1", "textCategory": "composicao",
  "text": "Maria Souza", "subtext": "Historiadora",               // espelho de nome/funcao: fallback, busca, legenda desligada
  "timeline_start": 12.0, "in": 0, "out": 6.0, "timelineStartFrame": 288, "inFrame": 0, "outFrame": 144,
  "composicao": { "schema": 1, "id": "lt_barra_limpa", "versao": "1.0.0", "origem": "biblioteca",
    "variaveis": { "nome": "Maria Souza", "funcao": "Historiadora", "cor_destaque": "#ff5a36" },
    "ligacoes":  { "nome": {"fonte": "pessoa", "id": 12}, "funcao": {"fonte": "entidade", "id": 5, "campo": "role"} } } }
```

### 6.2 Manifesto `src/ui/composicoes/<id>/composicao.json` (`schema: 1`)

```jsonc
{ "schema": 1, "id": "lt_barra_limpa", "versao": "1.0.0", "titulo": "GC barra limpa", "categoria": "gc",
  "origem_hf": {"item": "lt-clean-bar", "licenca": "Apache-2.0", "alterado": true},
  "palco": {"largura": 1920, "altura": 1080}, "ajuste": "caber", "ancora": "cheio",
  "duracao_natural_s": 4.8, "regioes": {"entrada_fim_s": 0.94, "saida_inicio_s": 4.3},
  "dinamica": "waapi", "alfa": true, "miniatura_t": 1.5,
  "fontes": [{"familia": "Montserrat", "arquivo": "../fontes/montserrat-var.woff2", "pesos": "100 900"}],
  "variaveis": [ {"id": "nome", "type": "string", "label": "Nome", "default": "Nome Sobrenome", "maxLength": 40},
                 {"id": "funcao", "type": "string", "label": "Função", "default": "Função ou cargo", "maxLength": 60},
                 {"id": "cor_destaque", "type": "color", "label": "Cor de destaque", "default": "#ff5a36"} ] }
```

**Tempo da composição.** Com duração do clipe `D`, natural `N`, entrada `e`, saída `s` e `m = N - s`: se `D ≥ e + m`, `t < e → t`; `e ≤ t < D - m → e` (meio parado); `t ≥ D - m → s + (t - (D - m))`. Se `D < e + m`, escala linear `t · N / D`. Sem `regioes`: `min(t, N)`. O lint confere que a chave em `e` e em `s - ε` é a mesma (meio realmente parado).

### 6.3 Compatibilidade

| Situação | Comportamento |
|---|---|
| Timeline antiga (sem `composicao`) | idêntica; nenhum campo novo é exigido; `version: 2` não muda |
| Timeline nova no Talho antigo | clipe `type:"text"` desenhado como título comum com nome e função. **[a conferir]** que a serialização do front não descarta campos desconhecidos |
| `schema` maior que o suportado, ou composição ausente | desenha como título de texto + `COMPOSICAO_INDISPONIVEL` (warn) no preflight e no banner |
| `versao` da biblioteca com outra major | usa a atual e avisa `COMPOSICAO_VERSAO`; o cache usa o hash dos arquivos |
| `modelo.normalizar` | **sem mudança de lógica:** `bruto=dict(c)` (`modelo.py:478`) já leva `composicao`; só o comentário de `Clipe.bruto` (133-135) e um teste que prova isso |
| Legendas SRT/VTT/ASS | ignoram clipes com `composicao` (`subtitles_export.py:50,83,136`) |
| OTIO | gerador + `metadata.capiau.composicao`; importação recria o clipe; XML/EDL: 4.7 |
| Alternativa A (`type:"html"`) | exigiria `bruto` para o novo tipo, `fidelidade` e `titulos` testando `c.tipo`, e os 9 arquivos de UI |

Códigos novos em `fidelidade.py`: `COMPOSICAO_INDISPONIVEL`, `COMPOSICAO_VERSAO`, `COMPOSICAO_FONTE_AUSENTE`, `COMPOSICAO_VARIAVEL_INVALIDA`, `COMPOSICAO_PROPORCAO` (info), `COMPOSICAO_PESADA` (estimativa > 3 min por clipe) e, em tempo de render, `COMPOSICAO_REDE_BLOQUEADA`. `TITULOS_SEM_NAVEGADOR` passa a citar composições.

## 7. Mudanças por arquivo

| Arquivo | Novo/alterado | O que muda |
|---|---|---|
| `src/services/composicoes.py` | novo | catálogo da biblioteca, leitura e validação do manifesto, hash dos arquivos, resolução de ligações (pessoa/entidade) |
| `src/export/video_render/composicoes.py` | novo | `GeradorComposicoes` sobre o `Navegador` da D1; `grupos()` no mesmo formato de `GeradorTitulos.grupos` |
| `src/export/video_render/titulos.py` | alterado | `preparar_titulos` despacha clipes com `composicao`, emite composições antes de texto (Z1), chave de cache |
| `src/export/video_render/execucao.py` | alterado | abre o navegador também se houver composição; `fechar()` no `finally`; cancelamento |
| `src/export/video_render/fidelidade.py` | alterado | códigos de 6.3; estimativa de tempo |
| `src/export/video_render/modelo.py` | alterado (comentário) | doc de `Clipe.bruto` (133-135) |
| `src/export/otio_export.py`, `otio_import.py` | alterados | gerador + metadados; ProRes 4444 opcional; restauração |
| `src/export/subtitles_export.py` | alterado | ignora `composicao` (3 pontos) |
| `src/api/routes/composicoes.py`, `src/api/server.py` | novo, alterado | `GET /api/composicoes`, `GET /api/composicoes/{id}`, `POST /api/composicoes/resolver`; `include_router` (~97-104); montagem de `/composicoes` com CSP **antes** de `server.py:175` |
| `src/ui/js/composicaoPalco.js` | novo | iframe, escala, âncora, regiões, mensagens (preview e render) |
| `src/ui/js/composicaoVariaveis.js` | novo | normalização e validação (espelho do Python), `criarClipeComposicao` |
| `src/ui/js/playerComposicoes.js` | novo | camada `#program-composicoes-layer`, pool de iframes, busca por rAF |
| `src/ui/js/playerTextOverlay.js`, `player.js` | alterados | filtro `!c.composicao` (101-106); instanciar `PlayerComposicoes` ao lado de `player.js:2549` |
| `src/ui/js/composicoesUI.js`, `titlesTab.js`, `timelineInteraction.js` (~8078), `timelineRenderer.js` (~1845) | novo, alterados | grade da biblioteca, inspetor gerado, ligações, cor da pista |
| `src/ui/render_composicao.html`, `src/ui/js/renderComposicoes.js` | novos | página fotografada (análoga a `render_titulos.html`) |
| `src/ui/composicoes/` | novo | `runtime/capiau-comp.js`, `runtime/anima.js`, `biblioteca.json`, uma pasta por composição (`index.html`, `composicao.json`, `miniatura.png`), `fontes/`, `dados/`, `LICENCAS.md` |
| `scripts/lint_composicoes.py`, `gerar_miniaturas_composicoes.py`, `spike_composicoes.py` | novos | lint estático e de navegador, miniaturas, spike |
| `tests/test_composicoes_manifesto.py`, `test_composicoes_biblioteca.py`, `test_render_composicoes.py`, `test_otio_composicao.py`, `autoteste_composicoes_runtime.mjs`, `autoteste_player_composicoes.mjs`, `tests/render_regressao/cenarios/clipe_html_*.json` | novos | seção 9 |
| `docs/plano_hyperframes/D2_composicoes_html.md`, `MEDICOES_COMPOSICOES.md`, `CREDITOS_TERCEIROS.md`, `PESQUISA_HYPERFRAMES.md` (§4.3) | novos, alterado | plano, números, créditos Apache-2.0/OFL/ISC, correções de 3.2 |

## 8. Etapas

Cada etapa = 1 commit (conventional commits em português), direto na main, só os seus trechos. Total **≈ 31 dias** em três entregas: **(1) E0–E6 ≈ 18 d** (5 GCs ligados à biometria, inspetor, render e preview), **(2) E7–E9 ≈ 9 d** (cartelas, contador, gráficos, mapa), **(3) E10–E11 ≈ 4 d** (antes/depois, camcorder, export). E12 (HTML do usuário) +3 d, opcional. E0, E1, E2 e E4 não usam o navegador da D1 e podem andar junto com ela.

| Etapa | Commit | Conteúdo e tempo de porte | Testes | Dias | Depende de |
|---|---|---|---|---:|---|
| E0 | `docs(composicoes): spike de busca por WAAPI e deduplicação por chave` | `scripts/spike_composicoes.py` (Playwright direto, descartável) no Edge do Fernando: porte de `lt-clean-bar` (CSS puro) e `count-up` (`aoBuscar`); compara com o original do HF rodando GSAP **baixado em pasta temporária fora do repositório**, só para medir; latência de `postMessage`, custo de `getAnimations()`, foto PNG alfa p50/p95, memória e carga de um iframe, `z-index` do canvas do cache. Resultado em `docs/MEDICOES_COMPOSICOES.md` | critérios do spike: PSNR ≥ 38 dB (animado) e ≥ 50 dB (parado); chave sólida; p95 de `buscar` (mensagem → resposta) ≤ 10 ms. Falhou a chave ⇒ `dedupe="hash"` como padrão | 1 | Edge + Playwright |
| E1 | `feat(composicoes): runtime de busca e variáveis com autoteste` | `capiau-comp.js` (porta `css.ts`, `waapi.ts`, `_holdAnimationAt.ts`, `applyVariableBindings.ts`), `anima.js`, `composicaoPalco.js`, `composicaoVariaveis.js` | `tests/autoteste_composicoes_runtime.mjs` (DOM falso) | 3 | E0 |
| E2 | `feat(composicoes): manifesto, catálogo e lt_barra_limpa` | `src/services/composicoes.py`, pasta `src/ui/composicoes/` com runtime, fonte Montserrat (OFL), `LICENCAS.md`, `lint_composicoes.py`, rota `GET /api/composicoes`, montagem com CSP; **porte de `lt-clean-bar`: 0,3 d** | `test_composicoes_manifesto.py`, `test_composicoes_biblioteca.py` (sem rede, sem `Math.random`), cabeçalho CSP | 2 | E1 |
| E3 | `feat(render): composições HTML no export pelo Navegador da D1` | `render_composicao.html`, `renderComposicoes.js`, `GeradorComposicoes`, despacho em `preparar_titulos` (Z1, chave de cache), `execucao.py`, `fidelidade.py`, legendas ignoram `composicao`. **Antes:** teste A/B dos títulos da D1 passando | `test_render_composicoes.py` (puro + `skipif` navegador), casos B `clipe_html_lt/dedupe/rede`, **cascata** | 3 | E2; **D1 E1–E4** |
| E4 | `feat(player): camada de composições em iframes sincronizados com o playhead` | `playerComposicoes.js`, filtro no overlay, instanciação em `player.js`, pool e coalescência, escala; checagem do `z-index` do cache | `autoteste_player_composicoes.mjs` (ciclo de vida, uma mensagem por rAF, reverso, nunca destruir o que está no ar), **cascata Node**, roteiro manual: scrub, J/K/L, reverso, loop, cache hit | 3 | E1, E2 |
| E5 | `feat(titler): biblioteca de composições, inspetor de variáveis e ligação com pessoas e entidades` | `composicoesUI.js`, `titlesTab.js`, `timelineInteraction.js`, `timelineRenderer.js`, `POST /api/composicoes/resolver`, grade `tabela`, seletor de foto, desfazer. **UI só liga com E3 pronta** | autoteste do mapa tipo → controle e da resolução; roteiro manual com projeto real | 4 | E3, E4; confirmar pessoa ↔ entidade |
| E6 | `feat(composicoes): GCs side-rule, kicker-name, dark-card e mask-reveal` | porte: `lt-side-rule` 0,3; `lt-kicker-name` 0,3; `lt-dark-card` 0,3; `lt-mask-reveal` 0,4 (+ fontes JetBrains Mono, League Gothic, Archivo Black, Space Mono) | referência B por composição, solidez da chave | 1,5 | E5 |
| E7 | `feat(composicoes): cartelas calm, lockup, máquina de escrever e contador` | `titlecard-calm` 0,5; `titlecard-lockup` 0,7; `typewriter` 1; `count-up` 0,7 | idem + `estado()` das duas últimas | 3 | E3 |
| E8 | `feat(composicoes): gráficos de barras e de linha com variável tabela` | `animated-bar-chart` 1,5; `mk-line-graph` 1,5 | idem + tabela com 2 e 8 linhas | 3 | E5 |
| E9 | `feat(composicoes): mapa-múndi com rota (d3-geo e topojson locais)` | `mapa_rota` de `world-map`: 3 d, com d3-geo, topojson-client e `world-atlas` 110m vendorizados (ISC), `alfa:false`, arco por `geoInterpolate` em `aoBuscar` | tempo de render ≤ 3 min, 0 rede | 3 | E3 |
| E10 | `feat(composicoes): antes e depois (wipe) e HUD de camcorder` | `before-after-wipe` 1,2 (2 × `image`); `camcorder-hud` 0,5; opcional `news-ticker` 1 | referências | 2 | E5 |
| E11 | `feat(export): composições como gerador com metadados e vídeo com alfa opcional` | `otio_export.py`/`otio_import.py`, ProRes 4444 a partir do `ffconcat`, padrões por formato (4.7), avisos | `test_otio_composicao.py` (ida e volta; `ffprobe` do `.mov`) | 2 | E3 |
| E12 | `feat(composicoes): importar HTML do usuário com sandbox, CSP e lint` | v2: pasta por projeto, lint, aviso de confiança | casos de ataque (fetch, `/api`, `top.location`) | 3 | E3, E5 |

## 9. Testes e medições

| # | Teste ou medição | Como | Alvo |
|---|---|---|---|
| 1 | Runtime (Node, DOM falso) | regiões (`D < e+m`, `D` grande), `sanitizeCssValue`, `isSafeMediaUrl`, validação de variáveis, mensagem de origem errada ignorada | 0 falhas |
| 2 | Biblioteca estática | manifesto válido, sem URL externa, sem `Math.random`/`Date.now`/`requestAnimationFrame`/`setInterval`/`fetch`, fontes presentes, `data-var-*` declaradas | 100% das composições |
| 3 | **Solidez da chave** (navegador) | renderizar todos os quadros sem dedupe e comparar cada um com o representante do grupo | 0 quadros com `max_abs > 0` |
| 4 | Porte contra o GSAP original (spike, local) | PSNR nos 9 quadros-chave | ≥ 38 dB animado; ≥ 50 dB parado |
| 5 | Paridade Program × export (B nível 2, `clipe_html_paridade`) | quadro-chave do iframe vs foto do export | PSNR ≥ 40 dB, `max_abs` ≤ 6 **[a medir]** |
| 6 | Deduplicação | `lt_barra_limpa` 4,8 s a 30 fps; clipe de 30 s com regiões | ≤ 45 fotos de 144; ≤ 45 fotos de 900 |
| 7 | Tempo de render (i7-10700, Edge) | LT 4,8 s; contador 3 s; barras 5 s; mapa 12 s opaco | ≤ 10 s; ≤ 15 s; ≤ 30 s; ≤ 3 min; RSS da árvore ≤ 1 GB (meta da D1) |
| 8 | Preview | p95 de `buscar` até pintar, 2 iframes; scrub de 10 s; 500 ciclos criar/destruir | ≤ 16 ms; 1 mensagem por rAF; heap do app +≤ 20 MB; ≤ 4 iframes |
| 9 | Rede e CSP | requisições a hosts fora do loopback no render das 14; `fetch('/api/…')` de dentro da composição | 0; falha |
| 10 | Escala | saídas 1280×720, 1920×1080, 3840×2160, 1080×1920 | tamanho exato; caixa do LT em 4K = 2x ± 1 px; 9:16 cabe no quadro |
| 11 | **Cascata** | `pytest tests/test_render_composicao_multipista_cascata.py`, `node tests/autoteste_composicao_multipista_cascata.mjs`; `clipe_html_cascata` (cenário 1 + clipe na pista de texto; desligado = ausente) | verdes; V1/V2 com `max_abs = 0` |
| 12 | Compatibilidade | timeline sem `composicao`: mesmos quadros e mesmo `sequence_json`; A/B dos títulos da D1 | idêntico |
| 13 | OTIO | ida e volta preserva `composicao`; `.mov` com `yuva444p10le`, duração = clipe ± 1 quadro | igualdade profunda |
| 14 | Legendas | 3 composições + 2 textos em SRT/VTT/ASS | só os 2 textos |

**Casos que acrescento ao harness da frente B** (formato de `B:6`, `sequencia` = `sequence_json` v2 real; 640×360 @ 24 fps): `clipe_html_lt` (LT sobre barras, alfa, 9 quadros-chave, `needs_browser`); `clipe_html_dedupe` (oráculo novo `dedupe_solido` em `oraculos.py`, registrado em `REGISTRO_ORACULOS`); `clipe_html_escala` (4 resoluções); `clipe_html_rede` (composição de teste que tenta `fetch` e `<img src=http>`: render termina, aviso, 0 requisições); `clipe_html_cascata` (cenário 1 + composição + bypass); N2 `clipe_html_paridade`. A linha "Clipe HTML | `clipe_html`" da tabela de `B:6` vira esses seis.

## 10. Critérios de aceite

1. As 14 composições renderizam **sem rede** (0 requisições fora do loopback) e o repositório não contém GSAP (`grep -ri gsap src/ui/composicoes` só em comentários de atribuição e em `LICENCAS.md`).
2. **Solidez da chave** (teste 3) e **paridade Program × arquivo** (teste 5) passam; a deduplicação entrega ≤ 45 fotos no LT de 4,8 s.
3. Tempos do teste 7 atendidos no i7-10700 do Fernando; pico de memória da árvore do navegador ≤ 1 GB.
4. Cascata verde (`pytest tests/test_render_composicao_multipista_cascata.py`, `node tests/autoteste_composicao_multipista_cascata.mjs`), `pytest -q` e autotestes Node existentes sem regressão; A/B dos títulos da D1 idêntico.
5. Sem navegador: o arquivo sai sem composições **e avisa**; o preflight não lança processo.
6. Timeline antiga idêntica; timeline nova abre no Talho antigo como título com nome e função (conferido numa cópia do banco).
7. Inspetor gera o controle de cada tipo; "ligar a pessoa/entidade" copia os valores; "Atualizar dos dados" mostra as diferenças; desfazer e refazer funcionam.
8. OTIO ida e volta preserva `composicao`; XML/EDL saem com `.mov` de alfa por padrão e com aviso; legendas não incluem composições.
9. Nada baixa sozinho. Créditos em `docs/CREDITOS_TERCEIROS.md` e `src/ui/composicoes/LICENCAS.md` (Apache-2.0 do HF, OFL das fontes, ISC de d3-geo/topojson/world-atlas); cabeçalho "Copyright 2026 HeyGen, Inc., Apache-2.0" e indicação de alteração nos arquivos portados.
10. `docs/MEDICOES_COMPOSICOES.md` com os números e `docs/PESQUISA_HYPERFRAMES.md` §4.3 corrigido. A Entrega 1 só vai ao ar depois do roteiro manual do Fernando (scrub, J/K/L, reverso, loop, cache hit, 720p, 4K).

## 11. Riscos e mitigação

| # | Risco | Mitigação |
|---|---|---|
| 1 | Chave de deduplicação errada (foto repetida no quadro errado) | teste 3 como bloqueio; lint; `dinamica:"js"` exige `estado()`; reserva `dedupe="hash"` |
| 2 | Edge visível e headless divergem (fonte, serrilhado, alfa) | mesma engine; teste 5; `assinatura()` no cache; fontes vendorizadas |
| 3 | Iframes pesam no Program (memória, quadros perdidos) | pool ≤ 4, coalescência, pré-aquecimento; E0 mede; plano B fora desta frente: pré-renderizar o trecho no Render Cache |
| 4 | `postMessage` fora de ordem ou respostas velhas | `id` por pedido; descartar resposta com `id` antigo |
| 5 | Porte GSAP → CSS mais caro que o estimado (eases, `clip-path`, stagger) | E0 porta 2 composições antes de comprometer; `anima.js` cobre o resto; corte: cair de 14 para 9 |
| 6 | Mapa e gráficos de quadro cheio lentos | `alfa:false` (JPEG), PNG nível 1, `COMPOSICAO_PESADA` com estimativa, cancelamento entre fotos (D1) |
| 7 | Falta de fonte ou de rede no render | vendorizar, lint, `COMPOSICAO_FONTE_AUSENTE`, rede bloqueada em 3 camadas |
| 8 | Licença: GSAP não lido em primeira mão; OFL/ISC a documentar | não usar GSAP (decisão não depende do texto); `LICENCAS.md`; reler `gsap.com` antes de redistribuir qualquer coisa dele |
| 9 | HTML do usuário e `allow_origins=["*"]` | v1 só biblioteca; CSP + sandbox + `postMessage` (4.8); restringir o CORS é assunto à parte |
| 10 | Regressão em títulos e legendas pelo modelo B | filtros testados; A/B dos títulos; cascata |
| 11 | Canvas do Render Cache (`z-index:45`) cobrindo as camadas | E0 e E4 checam; correção de CSS para texto e composição |
| 12 | D1 atrasa ou o BeginFrame não sai | D2 só precisa de D1 E1–E4 (CDP/`page.screenshot`) |
| 13 | Talho antigo descarta `composicao` ao salvar | conferir a serialização do front; registrar versão mínima |
| 14 | Escopo de 31 dias | três entregas; corte mínimo E0–E6 (≈ 18 d) |

## 12. Perguntas para o Fernando

1. **Representação:** clipe `text` com objeto `composicao` (B), em vez de `type:"html"`? *Recomendo B* (seção 5, DP1).
2. **HTML do próprio usuário:** adiar para a v2 (E12)? *Recomendo adiar*; já tem algum HTML pronto que queira usar?
3. **Lista das 14:** manter? Trocar alguma (por exemplo `split-flap-board` no lugar de `typewriter`)? *Recomendo manter e começar pelos 5 GCs.*
4. **Nome e função:** `entity.role` está preenchido no seu fluxo? A pessoa da biometria tem uma entidade `person` de mesmo nome? *Recomendo instantâneo + botão "Atualizar".*
5. **Vertical e quadrado:** produz 9:16 ou 1:1? *Recomendo `caber` com aviso na v1*, variantes só se houver demanda.
6. **Texturas** (grão, light leak, vinheta) fora da v1? *Recomendo sim*; v2 como vídeo opaco com `screen`/`overlay`.
7. **Fontes:** vendorizar ≈ 8 famílias OFL (~1 MB) ou usar só Inter/Outfit/Barlow que já existem? *Recomendo vendorizar* (o visual de cada GC depende da fonte).
8. **Outros editores:** ProRes 4444 por padrão em XML/EDL (arquivos podem passar de 100 MB)? *Recomendo sim, com aviso*; alternativa: sequência PNG.
9. **Spike E0:** pode rodar `scripts/spike_composicoes.py` no Windows e colar a saída? Seu ffmpeg tem `prores_ks`?
10. **GSAP:** libera `gsap.com` na rede da sessão (ou cola o texto da licença) para eu ler em primeira mão? *Recomendo*, antes de qualquer ideia de redistribuir GSAP; a decisão de portar não depende disso.
11. **Monitor:** v1 sem arrastar nem escalar a composição no monitor (só pelo inspetor)? *Recomendo sim*; v1.1 reaproveita `evaluateClipTransform`.

## 13. Prompt para o chat de implementação

````markdown
# Chat D2: clipe de composição HTML (motion graphics) no CapIAu Talho

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> Faça as Etapas 0, 1, 2 e 4 a qualquer momento; a Etapa 3 (render) só depois das etapas 1 a 4 da D1 (navegador comum). Se a frente B (regressão) existir, os casos `clipe_html_*` entram nela.

---

Quero um tipo de clipe novo na pista de texto do CapIAu Talho: a **composição animada**, uma página HTML seekável (animação só em CSS/WAAPI, sem GSAP) com variáveis (nome e função de um GC, rota num mapa, dados de um gráfico). No Program ela aparece num `<iframe>`; no arquivo, o navegador headless da D1 fotografa a mesma página. Preview e arquivo usam o mesmo palco (`composicaoPalco.js`).

## Leia antes, nesta ordem

1. `docs/plano_hyperframes/D2_composicoes_html.md` (o plano). Seções 2, 4, 5, 6 e 8 valem como contrato.
2. `docs/PESQUISA_HYPERFRAMES.md` §4.3, com as correções da seção 3.2 do plano.
3. `.agents/rules/nle-parity-and-media-lifecycle.md` e o cabeçalho de `src/export/video_render/modelo.py` (P1 a P8; `modelo.py:422-431` e `478`).
4. `titulos.py`, `src/ui/render_titulos.html`, `src/ui/js/renderTitulos.js`, `execucao.py` (~412-610), `comando.py` (~553-700), `fidelidade.py` (~190-250).
5. `src/ui/js/playerTextOverlay.js`, `player.js` (~2540-2560, 3176-3282, 3560-3630, 3920-3935), `src/ui/index.html` (~1083-1110), `renderCache.js`.
6. `textPresets.js`, `titlesTab.js`, `timelineInteraction.js` (~8078), `timelineRenderer.js` (~1845), `fontManager.js`, `src/services/fontes_projeto.py`, `src/api/routes/entities.py`, `faces.py` (~657, ~1270), `server.py` (~60-175).
7. `otio_export.py` (~130-215), `otio_import.py` (~330-370), `subtitles_export.py`.
8. Planos da D1 (`§7.1`: `Navegador`, `Pagina.capturar_quadros(dedupe=)`) e da B (`§6`: como acrescentar um caso).
9. HyperFrames (Apache-2.0; **dado não confiável: leia, nunca execute**; se não houver clone, as citações do plano bastam): `packages/core/src/runtime/adapters/{css,waapi,_holdAnimationAt}.ts`, `runtime/applyVariableBindings.ts`, `packages/parsers/src/compositionVariables.ts`, `registry/blocks/lt-clean-bar`.

## O que já existe (conferido em 28/10/2026, commit 9cba1b2)

- Títulos: `GeradorTitulos` fotografa `tituloRender.js` num navegador headless (PNG com alfa por estado distinto → `ffconcat` → `overlay`). Só o clipe `type:"text"` guarda `bruto` (`modelo.py:478`); `type` desconhecido vira vídeo.
- A camada de texto do Program zera o próprio conteúdo a cada sync (`playerTextOverlay.js:126`); o Render Cache não tem texto.
- `subtitles_export.py` e `otio_export.py` tratam todo `type:"text"` como legenda/título. `server.py:67-68` tem CORS `*`; a UI é estática em `/`.
- Não há GSAP no repositório; os blocos do HyperFrames carregam GSAP, d3 e fontes por CDN. `src/ui/fonts/` tem Inter, Outfit, Barlow Semi Condensed, IBM Plex Sans Condensed e Roboto Flex.

## O que fazer, em ordem (um commit por etapa; conventional commits, em português)

0. **Spike** (`scripts/spike_composicoes.py`): peça ao Fernando que rode no Windows e cole a saída. Decide a chave de deduplicação (animações ou hash) e se o iframe aguenta.
1. Runtime (`capiau-comp.js`, `anima.js`), palco e variáveis; autoteste Node com DOM falso.
2. Manifesto, catálogo, `lt_barra_limpa`, lint, CSP em `/composicoes`.
3. Render pela base da D1 (teste A/B dos títulos antes), regra Z1, `fidelidade.py`, legendas ignoram `composicao`.
4. Preview: `playerComposicoes.js`, iframes persistentes; confira o `z-index` do canvas do Render Cache.
5. UI: Titler, inspetor gerado, ligação com pessoas e entidades (confirme a relação antes).
6. a 11. Porte das composições do plano (seção 4.2) na ordem das etapas e export OTIO/XML/EDL. A Etapa 12 (HTML do usuário) só se eu pedir.

## Pergunte antes de decidir

- Depois do spike: números de `postMessage`, foto e iframe, e se a chave sólida passou; proponha manter ou cortar.
- Antes da Etapa 3: confirmar a representação (clipe `text` + `composicao`), a regra Z1 e a CSP. Antes da 5: a relação pessoa ↔ entidade e onde está a função.
- Antes de cada porte: mostre miniatura e quadros-chave e pergunte se aprovo. Antes da 11: ProRes 4444 por padrão em XML/EDL?

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev` e `docs/HANDOFF_DESIGN_UI.md` se existirem (tela nova: 9-12 px, `var(--fs-N)`, `var(--sp-N)`, `--accent`).
- Outra sessão mexe na interface. Commit só dos seus trechos (índice a partir do HEAD), direto na main, sem coautoria, sem push.
- Nada baixa sozinho; nada de `playwright install`; nada de CDN dentro das composições. **GSAP não entra** (licença não-OSI).
- Toda mudança em `titulos.py`, `execucao.py`, `comando.py`, `modelo.py` ou `player.js` passa no cenário canônico multipista em cascata (`pytest tests/test_render_composicao_multipista_cascata.py` e `node tests/autoteste_composicao_multipista_cascata.mjs`). Nunca destrua o iframe que está no ar.
- Windows: `pathlib`, `ctypes` (sem psutil). Scripts de edição em arquivo, com `PYTHONUTF8=1`. Servidor de teste `capiau-server-venv` (8022).
- Código portado do HyperFrames: cabeçalho "Copyright 2026 HeyGen, Inc., Apache-2.0", indicação de alteração e entrada em `docs/CREDITOS_TERCEIROS.md`. Fontes OFL e dados ISC com o texto da licença.
- Português, direto. Verifique antes de afirmar e marque [lido], [inferência] ou [a medir].

## Pronto quando

As 14 composições do plano saem no arquivo com os mesmos pixels do Program (teste 5), sem rede e dentro dos tempos do teste 7; a cascata e os testes antigos seguem verdes; o inspetor liga nome e função a pessoas e entidades; a timeline antiga fica idêntica; `docs/MEDICOES_COMPOSICOES.md` e os créditos estão no repositório.
````
