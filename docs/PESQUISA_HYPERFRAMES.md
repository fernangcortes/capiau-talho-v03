# Pesquisa: HyperFrames (heygen-com/hyperframes): o que o CapIAu-Talho pode aproveitar

> Repositório analisado: [github.com/heygen-com/hyperframes](https://github.com/heygen-com/hyperframes),
> `main` em 21/10/2026 (commit `4371981`, versão 0.8.185). Lido no código, não executado.
> Convenção: **[lido]** = conferido no código-fonte; **[inferência]** = dedução minha;
> **[a medir]** = precisa de teste prático antes de decidir.

---

## 1. Resumo

O HyperFrames **não é um NLE** e não substitui nada do Talho. É um renderizador "HTML → MP4"
determinístico: uma composição é uma página HTML com `data-start`/`data-duration`, as animações
(GSAP, CSS, WAAPI, Lottie, mapas…) são "seekáveis", e o motor abre a página num Chrome headless,
avança quadro a quadro, fotografa e codifica com FFmpeg. Em volta disso tem um catálogo de cerca
de 450 blocos prontos (lower thirds, legendas, mapas, gráficos, transições), uma Studio em React
e "skills" que ensinam agentes de IA a montar vídeos.

O Talho já chegou sozinho à mesma ideia central: os títulos do export são **o mesmo código do
preview fotografado num navegador headless** (`src/export/video_render/titulos.py` +
`src/ui/render_titulos.html`). Por isso boa parte do HyperFrames encaixa sem mudar a arquitetura.

O que vale trazer, em ordem de retorno:

| # | O quê | Resolve no Talho | Esforço |
|---|---|---|---|
| 1 | Áudio do export processado pelo **mesmo grafo WebAudio** do player, num `OfflineAudioContext` | As duas divergências medidas e expostas no banner de fidelidade (joelho do compressor: 2,06 dB; detector do gate) | M |
| 2 | **Legendas a partir da transcrição palavra a palavra** (agrupamento, ajuste, posição, filtro de alucinação) | Hoje as legendas só saem de clipes de texto feitos à mão | P–M |
| 3 | **Clipe de composição HTML** na pista de texto, com uma curadoria de blocos (GCs, mapas, gráficos, texturas de arquivo) | O Titler só faz caixa de texto com keyframes | M–G |
| 4 | Captura **BeginFrame** e flags de determinismo do Chromium | Lentidão de títulos que mudam a cada quadro (máquina de escrever, karaokê) | P–M |
| 5 | ASR local **Parakeet TDT 0.6B v3 via sherpa-onnx** (tempo por palavra, em CPU, com português) | Hoje tempo por palavra local exige o `.venv-nemo` (Canary) | P–M |
| 6 | Módulos de áudio: automação de volume, *voice carve*, nivelador, detecção de batida, rampa de velocidade | Recursos que o Talho não tem | M cada |
| 7 | Cor: leitor de LUT `.cube`, curvas, analisador de grade, HDR → SDR | Próximo passo do "OCIO Fase 0" | M |
| 8 | Teste de regressão do render por **PSNR contra vídeos de referência** | Os testes de render hoje conferem a string do filtro, não a imagem | M |
| 9 | Ferramentas de revisão para o agente editor (folhas de contato nos cortes, contraste WCAG dos GCs) | O agente propõe cortes mas não os vê | P–M |

P = até 3 dias, M = 1 a 2 semanas, G = mais de 2 semanas **[inferência; estimativa grossa]**.

E o que **não** vale trazer está na seção 5: o renderizador inteiro (para footage o grafo FFmpeg
do Talho é a escolha certa), a Studio em React, o render distribuído na nuvem.

---

## 2. O que é o HyperFrames, em números

- **Licença Apache-2.0** **[lido]**. Monorepo TypeScript (bun), Node ≥ 22 + FFmpeg. Cerca de
  456 mil linhas de TypeScript fora os testes **[lido; contagem por pacote]**. Usado em produção
  pela HeyGen. Muito ativo: uma versão por dia, em média.
- **Pacotes** **[lido]**:

| Pacote | Linhas | Papel |
|---|---:|---|
| `engine` | 32 mil | Chrome headless + CDP: captura por BeginFrame, extração de quadros de `<video>` via FFmpeg, mixagem de áudio, encoder em pedaços ou em fluxo, workers paralelos |
| `producer` | 41 mil | Pipeline completo (captura + encode + áudio), harness de regressão por PSNR |
| `core` | 57 mil | Tipos, runtime que roda dentro da página, adaptadores de animação, áudio (FX, automação, análise), cor (grading, LUT, curvas), VFX |
| `cli` | 87 mil | `init`, `preview`, `render`, `lint`, `check`, `snapshot`, `transcribe`, `remove-background`, `beats`, `tts`… |
| `studio` + `studio-server` | 182 mil | Editor em React (iframe + overlay), legendas, WebMCP para agentes |
| `shader-transitions` | 3,7 mil | 14 transições em GLSL |
| `player`, `sdk`, `parsers`, `lint`, `inspector` | — | Web component de player, edição headless, parsers do GSAP |
| `aws-lambda`, `gcp-cloud-run` | — | Render distribuído |

- **Catálogo** (`registry/`): 210 blocos + 239 componentes, cada um um HTML com
  `registry-item.json` **[lido]**.
- **Skills** (`skills/`): conhecimento destilado de produção (legendas, som, cor, revisão), escrito
  como instruções para agente **[lido]**. Mais úteis para o Talho do que parece: são regras
  medidas, não opinião.

---

## 3. Onde os dois projetos já se encontram

| Problema | Talho hoje | HyperFrames | Leitura |
|---|---|---|---|
| Título idêntico no preview e no arquivo | Playwright fotografa `tituloRender.js` por estado visual distinto; PNGs viram `ffconcat` (`titulos.py`) | Página seekável fotografada quadro a quadro por BeginFrame (`engine/src/services/screenshotService.ts`) | Mesma ideia. O Talho deduplica melhor (chave de estado); o HF captura mais rápido e de forma determinística |
| Paridade de cor | CSS `filter` no player, traduzido para `lutrgb` + `colorchannelmixer` no FFmpeg (`cor.py`), conferido à mão | Grading em WebGL dentro da página; o render fotografa o mesmo canvas | Para footage longa o caminho do Talho é o certo (ver seção 5) |
| Paridade de áudio | Grafo WebAudio no player, **reimplementado** em filtros FFmpeg (`grafo_audio.py`); duas divergências medidas e expostas | **Mesmo grafo WebAudio** num `OfflineAudioContext` no Chrome headless (`engine/src/services/audioFxRender.ts`) | Aqui o HF resolveu o problema que o Talho documenta. Item 4.1 |
| Pré-checagem honesta | `fidelidade.py`: preflight que diz o que o motor não reproduz | `check`/`lint`: erros de runtime, layout, contraste, "trecho morto" | Complementares |
| Agente de IA | Agente com *function calling* que edita a timeline e propõe *ghost clips* | Skills + WebMCP na Studio; o agente escreve HTML e **olha os quadros** | O HF dá ao agente olhos (item 4.9) |
| Legendas | SRT/VTT/ASS dos clipes de texto (`subtitles_export.py`) | Legendas geradas da transcrição palavra a palavra, 17 estilos de legenda animada | Lacuna clara no Talho (item 4.2) |

---

## 4. Recomendações

### 4.1 Áudio do export pelo mesmo grafo WebAudio do player ⭐

**O problema no Talho [lido].** `src/export/video_render/grafo_audio.py` reimplementa em filtros
FFmpeg a cadeia que o player monta em WebAudio (`fonte → volume → hpf → low → mid → high → gate →
comp → makeup`). Duas peças não têm equivalente no FFmpeg, e o próprio código registra:

- o `DynamicsCompressorNode` tem joelho de 30 dB, o `acompressor` vai até 8: diferença medida de
  2,06 dB no limiar (`fidelidade.py`, `TEXTO_JOELHO_COMPRESSOR`);
- o gate do player (`audioGateWorklet.js`) decide por bloco de 128 amostras, o `agate` por amostra
  (`TEXTO_DETECTOR_GATE`, "enquanto não medida, fica no banner").

**Como o HyperFrames resolve [lido].** `packages/engine/src/services/audioFxRender.ts` não traduz
nada para FFmpeg: lê o WAV, abre uma página no Chrome headless que o motor já controla e roda
**os mesmos construtores de grafo do preview** num `OfflineAudioContext`. O comentário de abertura
do arquivo é o argumento: "há uma implementação de cada efeito, então o render igual ao preview é
propriedade da arquitetura, não tolerância a policiar". Detalhes que importam para o Talho:

- **Janelas com pré-rolagem** (`audioFxWarmup.ts`, `windowPrerollSeconds`): arquivos grandes são
  processados em janelas, cada uma alimentada antes com a "memória" da cadeia (release do
  compressor, cauda de delay) e descartada; o último trecho mantém a cauda.
- **Janelas alinhadas ao quantum de 128 quadros**: "uma janela que começa num múltiplo vê os mesmos
  blocos que um render inteiro". É exatamente o que torna o gate por bloco do Talho reproduzível.
- **Página nova por janela**: o navegador nunca segura mais de uma janela de áudio na memória.
- Leitor e escritor de WAV mínimos (16 bits e float32), recusando formato desconhecido em vez de
  ler ruído.

**Como encaixar no Talho [inferência].**

1. Extrair de `player.js` (`_efeitosAudioAoVivo`, `_topologiaAudioAoVivo`) um módulo puro que monta
   a cadeia num `BaseAudioContext` qualquer, como já foi feito com `tituloRender.js` para títulos.
   O player passa a usá-lo com o `AudioContext` ao vivo.
2. Uma página `render_audio.html`, servida pela mesma rota interna de `titulos.py`, que recebe um
   WAV e os parâmetros, roda a cadeia num `OfflineAudioContext` e devolve o WAV.
3. Em `grafo_audio.py`, manter no FFmpeg o que já é idêntico (decodificação, recorte `[in,out]`,
   envelope de volume × fade, que entra **antes** da cadeia pela regra 2, e a mixagem final por
   pista). Só o trecho `hpf…makeup` de clipes com EQ ou dinâmica ligados passa pela página.
4. Trocar dados por arquivo, não por `page.evaluate` (base64 de áudio longo é lento): a rota
   interna serve o WAV de entrada, e a saída volta por `POST` interceptado na mesma rota
   (`request.post_data_buffer`).
5. Remover os dois textos do banner de fidelidade quando o teste de paridade passar.

**Risco:** desempenho em timelines longas **[a medir]**. O HF processa em tempo de render sem
reclamações registradas, e o `OfflineAudioContext` roda bem acima do tempo real, mas convém medir
uma hora de áudio com o gate em AudioWorklet.

### 4.2 Legendas a partir da transcrição palavra a palavra ⭐

**Lacuna [lido].** O Talho guarda cada palavra com início e fim (`save_transcript_words`), usa isso
na edição por texto, mas `src/export/subtitles_export.py` só exporta **clipes de texto** já postos
na timeline. Para um documentário, gerar a legenda da montagem a partir das falas é o caso de uso
principal (acessibilidade, festivais, versões).

**O que o HyperFrames ensina [lido em `skills/hyperframes/references/captions.md`]:**

- **Grupos**: 3 a 5 palavras em fala conversacional (2–3 em ritmo alto, 4–6 calmo). Quebra no fim de
  frase, numa pausa de 150 ms ou mais, ou no limite de palavras. Um grupo visível por vez; abre no
  início da primeira palavra ou antes e fecha no fim da última ou depois. Nada exatamente em 0 s.
- **Associação por posição, nunca por texto**: senão uma palavra repetida pega o tempo da outra.
- **Ajuste**: tamanho calculado para caber (`core/src/text/fitTextFontSize.ts`: base 78, mínimo 42,
  passo 2; largura máxima 1600 px em 16:9, 900 em 9:16). Margem inferior de 80–120 px em 16:9,
  dentro da área segura de 80 %, nunca sobre o rosto.
- **Legibilidade sobre a imagem**: escolher pela luminância atrás do texto (0–255): abaixo de 60,
  `screen`; de 60 a 180, `overlay`; acima de 180, cor opaca normal. Legenda simples sobre fundo
  acima de 60 ganha uma faixa do tamanho do texto (30–40 %), nunca uma barra de largura total.
- **Alucinação do Whisper**: descartar palavras que começam dentro de um silêncio final
  (`silencedetect=noise=-35dB:d=0.6`); "Obrigado." inventado sobre silêncio é o caso clássico.
  O Talho já detecta loop repetido (`motores.py`, "Checagem de alucinação"), mas não este.
- **Transcrição que falhou**: mais de 20 % de `♪`/`�` ou palavras sem sentido.
- Vídeo que **já tem legenda queimada** só no meio: varrer uma folha de contato a 1 qps antes.

**Como encaixar [inferência].** Uma ação "Gerar legendas da sequência" que percorre os clipes de
áudio da timeline, projeta as palavras de cada fonte no tempo da timeline (descontando `in`,
velocidade, J/L-cuts e clipes desativados), agrupa pelas regras acima e grava **clipes de texto
numa pista de legendas**. A partir daí tudo que já existe funciona: edição à mão, SRT/VTT/ASS,
render com o mesmo motor de títulos. Estilos de karaokê (palavra ativa destacada) entram depois,
como preset do Titler; os 17 componentes `registry/components/caption-*` servem de referência
visual, e `packages/studio/src/captions/types.ts` dá um modelo de estilo pronto (sombra, brilho,
gradiente, contorno).

### 4.3 Clipe de composição HTML (motion graphics) na pista de texto

**A ideia.** Um tipo de clipe novo que aponta para uma página HTML seekável com variáveis:
"Lower third limpo" com `nome` e `função`, "Mapa com rota" com origem e destino, "Gráfico de
barras" com dados. Preview e export usam a mesma página, exatamente como os títulos.

**Por que encaixa [lido].**

- O render já existe: `titulos.py` abre uma página, posiciona no instante `t`, fotografa e monta
  um `ffconcat`. Basta generalizar `RENDER_TITULOS.desenhar(clip, t)` para "carregar composição,
  aplicar variáveis, buscar `t`".
- O HF define o protocolo de busca e tem **adaptadores** prontos para CSS, WAAPI, GSAP, Lottie,
  Leaflet, MapLibre, Mapbox, D3, three.js (`core/src/runtime/adapters/`). Os de CSS e WAAPI
  (~230 linhas cada) pausam toda animação da página e ajustam `currentTime`, o que torna seekável
  qualquer animação CSS comum.
- **Variáveis** sem script (`core/src/runtime/applyVariableBindings.ts`): `data-var-text="nome"`
  troca o texto do elemento, `data-var-src` troca a mídia, e cada variável vira `--nome` em CSS.
  Isso liga direto no que o Talho já sabe: o nome do personagem vem da biometria facial e a função
  vem das entidades.

**Curadoria sugerida para documentário [inferência; a maior parte do catálogo é marketing e redes
sociais]:**

| Uso | Blocos e componentes |
|---|---|
| GCs | `lt-clean-bar`, `lt-side-rule`, `lt-kicker-name`, `lt-mask-reveal`, `lt-dark-card`, `lt-stack-bars` e os demais `lt-*` |
| Lugar e trajeto | `world-map`, `spain-map`, `us-map-flow`, `nyc-paris-flight` (rota de voo), `split-flap-board` (datas e lugares) |
| Dados | `data-chart`, `bar-chart-race`, `nyt-graph`, `heatmap`, `mk-line-graph`, `count-up` |
| Textura de arquivo | `grain-overlay`, `light-leak`, `organic-light-leak-overlay`, `vignette`, `camcorder-hud`, exemplo `warm-grain` |
| Cartelas | `titlecard-calm`, `titlecard-lockup`, `typewriter`, `notes-reveal`, `news-ticker` |
| Restauração | `before-after-wipe` (antes e depois do tratamento), `freeze-frame-dressing` |

**Cuidados.**

- **GSAP não é software livre.** Os blocos carregam GSAP 3.14 pela CDN, sob a "GSAP Standard
  License", que o próprio `CREDITS.md` do HF diz não ser uma licença OSI. O Talho é GPLv3:
  **não embutir GSAP**. Para os 15–20 blocos escolhidos, reescrever a animação em CSS/WAAPI (ou no
  `keyframeEngine.js`) e manter o HTML/CSS, que é Apache-2.0. Isso também elimina o download da CDN
  na hora do render.
- Os blocos são desenhados em 1920×1080 fixo: escalar o palco para o tamanho da sequência.
- Sem chave de estado (é HTML arbitrário), a deduplicação de quadros iguais tem que ser por hash
  do PNG ou pelo `hasDamage` do BeginFrame (item 4.4).
- Preview no Program: um `<iframe>` sobre o monitor, como a Studio do HF faz
  (`packages/studio/AGENTS.md`: a composição vive num iframe, o "chrome" de edição fica fora dele
  para não ser capturado). O `<hyperframes-player>` (`packages/player`, ~7 mil linhas) é uma
  referência de como sincronizar o iframe com o playhead.

### 4.4 Captura por BeginFrame e flags de determinismo

**Hoje [lido].** `GeradorTitulos._abrir` lança o Edge/Chrome instalado sem argumentos e usa
`page.screenshot` por estado distinto. Para um título com fade isso são poucas fotos. Para algo que
muda todo quadro (máquina de escrever, karaokê, mapa animado, item 4.3) é uma foto por quadro, e
`page.screenshot` custa dezenas de milissegundos cada **[a medir]**.

**O que o HF faz [lido em `screenshotService.ts` e `browserManager.ts`].**

- `HeadlessExperimental.beginFrame` com `--enable-begin-frame-control --deterministic-mode`: uma
  chamada CDP faz layout, pintura, composição **e** devolve a imagem, com `hasDamage` dizendo se
  algo mudou. Se não mudou, reaproveita a última imagem.
- Exige o **`chrome-headless-shell`**, não o Chrome normal. O HF tem binário para win64 também.
  Quando a sonda de BeginFrame falha, cai para captura comum.
- Flags úteis mesmo sem BeginFrame: `--force-color-profile=srgb`, `--force-device-scale-factor=1`,
  `--run-all-compositor-stages-before-draw`, `--disable-threaded-animation`,
  `--disable-checker-imaging`, `--disable-background-timer-throttling`.

**Como encaixar [inferência].** No Playwright Python, `page.context.new_cdp_session(page)` dá
acesso ao CDP. O Playwright já distribui o `chromium-headless-shell`, mas o Talho escolheu não
exigir `playwright install` (`requirements.txt`). Proposta: BeginFrame **opcional** quando o
headless-shell estiver presente (Configurações > Modelos locais pode baixá-lo), mantendo o caminho
atual como reserva, como o HF faz. As flags de cor e escala podem entrar já, mas
`--force-color-profile=srgb` precisa de um teste de paridade contra o preview no Edge do usuário
antes **[a medir]**.

### 4.5 ASR local: Parakeet TDT 0.6B v3 via sherpa-onnx

**Hoje [lido].** Tempo por palavra local depende do Canary 1B v2, que precisa do NeMo, que precisa
de um ambiente separado (`requirements-nemo.txt`, `.venv-nemo`). O Talho **já usa sherpa-onnx** para
o denoise (`src/media/audio_denoise.py`).

**No HF [lido em `packages/cli/src/whisper/`].** `hyperframes models install parakeet` baixa o
export int8 em ONNX do Parakeet TDT 0.6B v3 e roda no sherpa-onnx (`sherpaWorker.ts`), sem PyTorch.
Detalhes reaproveitáveis:

- Línguas do modelo: inglês e 25 europeias, **com português** (`PARAKEET_LANGUAGES`); `pt-BR` conta
  como `pt`.
- O modelo devolve *tokens* com tempo; o HF junta tokens em palavras (`parakeet.ts`) e processa em
  janelas com folga, emendando e repetindo a decodificação quando uma janela perde tokens.
- Comparação citada no código: WER médio de ~6,05 % contra 7,44 % do whisper-large-v3, e menos
  alucinação em áudio ruidoso **[número do autor, não conferido]**.
- Licença do modelo **CC-BY-4.0**: exige atribuição.

**Como encaixar [inferência].** Um motor `parakeet_sherpa` em `motores.py`, no `.venv` principal,
com tempo por palavra. Rodar contra os gabaritos de avaliação (`docs/proximos_chats/06`) antes de
mexer na ordem dos motores.

### 4.6 Áudio: módulos que o Talho não tem

Todos em `packages/core/src/`, funções puras sobre amostras PCM, portáveis para Python ou para o
JS do player **[lido]**:

- **Automação** (`audioAutomation.ts`, 617 linhas): faixas de pontos sobre volume, velocidade ou
  qualquer parâmetro de efeito, com tempo **local ao clipe** (o envelope anda junto quando o clipe
  move). A mesma função de amostragem desenha a curva na timeline, agenda no preview e gera o
  render: "uma curva, três consumidores". O Talho não tem keyframe de volume (rubber band).
- **Voice carve** (`audioCarve.ts`, 767 linhas): em vez de abaixar a trilha inteira sob a voz,
  mede as bandas que a voz ocupa e cava só nelas, com filtros *peaking* na trilha musical. Funciona
  como sidechain: o controle fica na música e aponta para a voz. Resultado: uma cadeia comum de
  EQ, sem caminho de render novo.
- **Nivelador** (`audioLeveller.ts`): mede RMS em janelas e escreve uma faixa de automação que
  levanta os trechos baixos. Nomeado com honestidade: "não é LUFS" (não é BS.1770 com ponderação K),
  coisa que o `loudnorm` do Talho já cobre.
- **Batida e andamento** (`audioRhythm.ts`, `beats/`): fluxo espectral em bandas logarítmicas,
  andamento por autocorrelação e posicionamento de batidas por programação dinâmica (Ellis 2007),
  o mesmo algoritmo do `librosa.beat.beat_track`, que já está no `.venv-nemo`. Uso: marcadores de
  batida na régua e snap de corte na música.
- **Rampa de velocidade** (`speedRamp.ts`): velocidade variável como faixa de automação de
  `rate`, com `sourceTimeAt` como única conversão entre tempo da timeline e tempo da fonte. O Talho
  tem velocidade constante, reversa e "preencher lacuna"; rampa é a peça que falta.

### 4.7 Cor

**[lido]** em `packages/core/src/`:

- `colorLuts.ts`: leitor de `.cube` (1D/3D, `DOMAIN_MIN/MAX`, limite de tamanho, erro com número da
  linha) e empacotamento em textura 2D para WebGL.
- `colorGradingCurves.ts`: curvas por splines monotônicas com tabela de 1024 pontos.
- `mediaGradeAnalyzer.ts`: amostra 5 quadros com `signalstats` do FFmpeg e sugere exposição,
  contraste, pretos, brancos, temperatura e tom, com risco de estourar sombras e altas.
- `hdrToneMap.ts`: HDR → SDR BT.709 com `zscale` + `hable`, lendo as tags de cada quadro.
- `skills/media-use/luts/index.json`: catálogo de *looks* (teal & orange, bleach bypass…), cada
  um com URL de `.cube` **e** parâmetros para gerar a LUT sem rede.

**Para o Talho [inferência].** O "OCIO Fase 0" já detecta V-Log, S-Log, D-Log e HLG. O passo
natural é aplicar uma **LUT técnica** (log → Rec.709): no render é um `lut3d` do FFmpeg, trivial; no
preview, CSS `filter` não aplica LUT 3D, então o player precisaria de um caminho WebGL para esses
clipes. O `mediaGradeAnalyzer` é barato de portar para Python e serve já como "sugerir correção"
para footage escura ou lavada, e o `hdrToneMap` para material HLG/PQ de celular.

### 4.8 Regressão do render por PSNR contra vídeos de referência

**Hoje [lido].** Os testes de render do Talho (`tests/test_render_*.py`) conferem a string do grafo
FFmpeg. Não há comparação da **imagem** renderizada.

**No HF [lido em `packages/producer/tests/README.md` e `regression-harness.ts`].** Cada caso tem
`src/index.html`, um `output/output.mp4` de referência e um `meta.json` com `minPsnr`,
`maxFrameFailures`, `minAudioCorrelation` e `maxAudioLagWindows`. O harness renderiza e compara
quadro a quadro (`engine/src/utils/psnr.ts` é só `ffmpeg -lavfi psnr`) e o áudio por correlação.
As referências são geradas sempre no mesmo container, porque Chrome e FFmpeg mudam de versão.

**Para o Talho [inferência].** 10 a 15 sequências pequenas (`.json` da timeline + mídia sintética)
cobrindo os contratos que hoje vivem em docstrings: ordem dos efeitos, dissolve com `tpad`, camada
de ajuste com blend, título com caixa desfocada, fade com tensão. Também é o teste que valida o
item 4.1.

### 4.9 O agente editor com olhos

**Hoje [lido].** O agente (`src/services/chat_agent.py`) tem ferramentas para ler e alterar a
timeline (`get_timeline_state`, `propose_rough_cut`, `insert_clip`…), mas nenhuma para **ver** o
resultado.

**No HF [lido em `references/review.md` e `cli/src/commands/`].**

- `snapshot --review`: folhas de contato com cada cena logo após começar e no meio, e uma tira em
  cada corte de −0,2 s a +0,2 s. Para um copiloto de montagem, a tira no corte é o que revela
  pulo de eixo, quadro preto e flash.
- `check` mede problemas de ofício: texto na tela por menos tempo do que dá para ler
  (`line_unread`), mais de 3 s sem nada mudar (`dead_stretch`), texto menor que 2,6 % do lado menor
  do quadro, primeiro quadro vazio.
- Auditoria de **contraste WCAG** do texto sobre a imagem real (`contrast-audit.browser.js`):
  esconde a pintura do texto, fotografa e mede os pixels dentro da caixa de cada glifo.

**Para o Talho [inferência].** Uma ferramenta `revisar_corte` que gera a tira de cada corte da
proposta (FFmpeg já sabe) e manda para o modelo de visão, e um aviso no preflight para GC com
contraste baixo ou fora da área segura.

### 4.10 Transições em shader: baixa prioridade

O HF tem 14 transições GLSL (`packages/shader-transitions`) e porta as mesmas para CPU no motor
(`engine/src/utils/shaderTransitions.ts`, com conversão PQ/HLG para HDR). O Talho tem dissolve e
mergulho em preto e branco. Para documentário isso basta. Se um dia precisar de mais, o `xfade` do
FFmpeg já tem dezenas de transições e aceita expressão própria; o problema seria reproduzi-las no
preview, e esse custo não se paga agora **[inferência]**.

---

## 5. O que não vale aproveitar

- **O renderizador como substituto do grafo FFmpeg.** O HF faz cada quadro passar pelo Chrome,
  inclusive o vídeo: extrai quadros com FFmpeg e injeta como `<img>`
  (`videoFrameExtractor.ts`, `videoFrameInjector.ts`). Para peças de 10–90 s é ótimo; para
  montagem de documentário com horas de footage em HD/4K seria muito mais lento que o grafo
  FFmpeg que o Talho já tem, sem ganho de fidelidade no vídeo **[inferência]**. O Chrome fica só
  para o que é DOM ou WebAudio: títulos, composições HTML, cadeia de áudio.
- **A Studio** (React, 164 mil linhas): pilha diferente. Vale ler `packages/studio/AGENTS.md` pelas
  decisões (overlay fora do iframe, medição em vez de elemento), não o código.
- **Render distribuído** (Lambda, Cloud Run): o `PLANO_NUVEM.md` do Talho trata de dados e
  armazenamento, não de fazenda de render.
- **Skills de `slideshow`, `figma`, `remotion-to-hyperframes`** e o `frame.md` de design system:
  focados em vídeo de marketing.
- **Remoção de fundo** (`remove-background`): é o `u2net_human_seg` do rembg em ONNX; funciona, mas
  o próprio HF registra ~2 qps em 1080p em CPU e falhas com braço de microfone. Se o Talho precisar
  disso, há modelos melhores; não é motivo para trazer o código.

---

## 6. Licenças

- **Código do HyperFrames: Apache-2.0**, compatível com a GPLv3 do Talho no sentido Apache → GPL.
  Ao copiar ou portar código: manter o aviso de copyright e a licença, marcar os arquivos
  alterados e citar a origem (por exemplo no cabeçalho do arquivo e numa seção de créditos).
- **GSAP**: "GSAP Standard License", não OSI (o `CREDITS.md` do HF diz isso). Não embutir no Talho.
- **Parakeet TDT 0.6B v3**: CC-BY-4.0, exige atribuição na tela de Modelos locais.
- **u2net**: pesos do rembg/U-2-Net, Apache-2.0 **[não conferido no repositório de origem]**.
- **mediabunny** (usado só na Studio): MPL-2.0. Não é necessário.

---

## 7. Ordem sugerida

1. **Legendas da transcrição (4.2)**: maior valor visível, menor risco, usa só o que o Talho já
   tem. Inclui o filtro de silêncio final.
2. **Paridade de áudio pelo `OfflineAudioContext` (4.1)**, já acompanhada do primeiro teste PSNR e
   de correlação de áudio (4.8): fecha as duas divergências do banner.
3. **Parakeet via sherpa-onnx (4.5)**, comparado nos gabaritos antes de virar padrão.
4. **Flags e BeginFrame opcional (4.4)**, porque o item seguinte depende de captura rápida.
5. **Clipe de composição HTML (4.3)** com 15–20 blocos portados para CSS/WAAPI.
6. **Automação de volume + voice carve (4.6)**, depois **LUT técnica para log (4.7)**.
7. **Revisão visual do agente (4.9)** quando o copiloto voltar a ser o foco.

---

## 8. Arquivos de referência no HyperFrames

| Assunto | Caminho |
|---|---|
| Áudio no `OfflineAudioContext` | `packages/engine/src/services/audioFxRender.ts`, `audioFxWarmup.ts` |
| Definição dos efeitos de áudio | `packages/core/src/audioFx.ts`, `audioFxEq.ts`, `audioFxPresets.ts` |
| Automação, carve, nivelador, ritmo | `packages/core/src/audioAutomation.ts`, `audioCarve.ts`, `audioLeveller.ts`, `audioRhythm.ts` |
| Rampa de velocidade | `packages/core/src/speedRamp.ts` |
| Captura BeginFrame | `packages/engine/src/services/screenshotService.ts`, `browserManager.ts` (flags na linha ~320 e ~1050) |
| Adaptadores de busca | `packages/core/src/runtime/adapters/` (`css.ts`, `waapi.ts`, `lottie.ts`, `maplibre.ts`…) |
| Variáveis de composição | `packages/core/src/runtime/applyVariableBindings.ts`, `variables.ts` |
| Legendas | `skills/hyperframes/references/captions.md`, `packages/studio/src/captions/`, `packages/core/src/text/fitTextFontSize.ts`, `registry/components/caption-*` |
| ASR | `packages/cli/src/whisper/sherpaWorker.ts`, `parakeet.ts`, `transcribe.ts` |
| Cor | `packages/core/src/colorLuts.ts`, `colorGradingCurves.ts`, `mediaGradeAnalyzer.ts`, `hdrToneMap.ts`, `skills/media-use/luts/index.json` |
| Regressão PSNR | `packages/producer/tests/README.md`, `packages/producer/src/regression-harness.ts`, `packages/engine/src/utils/psnr.ts` |
| Revisão e auditorias | `skills/hyperframes/references/review.md`, `packages/cli/src/commands/contrast-audit.browser.js`, `layout-audit.browser.js` |
| Conhecimento de som e mixagem | `skills/hyperframes/references/sound.md`, `skills/media-use/references/mixing.md` |
