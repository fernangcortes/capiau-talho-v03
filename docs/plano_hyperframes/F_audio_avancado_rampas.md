# Frente F — Automação de volume, ducking, nivelador, batidas e rampa de velocidade

> **Resumo.** Entrega, nesta ordem: uma **faixa de automação por clipe** (tempo local ao clipe, hold nas pontas, só `linear` e `hold`) guardada em `clip.keyframes.volume` / `.rate`, o modelo que os títulos já usam, com **uma função de amostragem** em JS e em Python; volume automatizado no player, no render e desenhado sobre a forma de onda; ducking gerado das palavras da transcrição; nivelador por RMS; batidas por numpy na régua e no snap; rampa de velocidade (player, render, exportação).
> Valor: a música abaixa sozinha sob a voz, as falas ficam parelhas e os cortes caem na batida sem sair do Talho. Hoje o volume não é animável em lugar nenhum [lido: `keyframeEngine.js` não cita `volume`; `player.js:5008`; `grafo_audio.py:328`].
> Esforço ≈ 20 dias (F0–F8); o bloco de volume (F0–F3, 7 dias) já é útil sozinho. Dependências: nenhuma para F0–F6; frente A só para ganho acima de 0 dB; frente B só para os dois cenários de regressão.
> Principal risco: a rampa no player (`playbackRate` por quadro, deriva, áudio mudo acima de 2×) e a edição no canvas de 13,8 mil linhas. Todo número abaixo vem do contêiner (FFmpeg 6.1.1, Linux), não do Edge/Windows do Fernando.
> Decisão principal: **render sem assar PCM** (como o HyperFrames faz): soma plana de rampas em `volume … eval=frame` + `asetnsamples=256` e `setpts` em forma fechada para a rampa; medido 0,34 dB de pico e 162 de 162 quadros.

Convenções: **[lido]** conferido no código; **[inferência]** dedução minha; **[a medir]** falta teste; **[medido]** número meu em rascunho fora do repositório (contêiner, FFmpeg 6.1.1-3ubuntu5, sinais sintéticos); **[web]** nenhuma busca foi necessária. `HF:` = HyperFrames v0.8.185 (Apache-2.0, "Copyright 2026 HeyGen, Inc."), prefixo `packages/core/src/` salvo indicação. Estado do Talho conferido em 28/10/2026, commit `9cba1b2`; os planos A e B são tomados como prontos.

## 1. Objetivo e valor

| Recurso | O que o Fernando passa a fazer | Medida de sucesso |
|---|---|---|
| Automação de volume | Desenhar a curva sobre a onda do clipe (abaixar a música em um trecho, subir no final) e ouvir igual no render | RMS por janela de 100 ms = curva ± 0,05 dB no render (medido 0,004 dB) |
| Ducking | Um botão "Abaixar sob a voz" na música: a faixa nasce das palavras da transcrição e fica editável | música ≥ 10 dB abaixo quando a voz fala, já no início da primeira palavra |
| Nivelador | Falas fortes e fracas do mesmo clipe ficam parelhas, com a curva visível | desvio do RMS por frase cai ≥ 40% no fixture; nenhum ponto fora de ±12 dB |
| Batidas | Ver as batidas da música e cortar/encaixar nelas com o snap | ≥ 95% das batidas a ±30 ms em 120 BPM sintético |
| Rampa de velocidade | Acelerar e frear dentro de um clipe (presets tipo montagem) com vídeo e áudio em sincronia | ids de origem por quadro seguem `sourceTimeAt` (desvio medido 0,80 quadro) |

Fora do escopo: voice carve (exige estender o contrato E2, ver 4.2), ganho acima de 0 dB (depende da A), `minterpolate` e `rubberband` como padrão (4.5), automação de parâmetros de efeito (o modelo já a comporta; entra depois).

## 2. Estado atual no Talho
| Peça | Onde | Fato [lido] | Consequência |
|---|---|---|---|
| Volume no player | `player.js:4979-5008` | `el.volume = clamp(pista × level × fade × forcedGain, 0, 1)`; `level` vem do bloco `volume`; mudo se `isHighSpeedOrReverse` | teto 0 dB; a faixa é mais um fator do produto |
| Volume no render | `grafo_audio.py:328-390` | mesmo produto em `clip(...,0,1)`; fades por `min()`; `extras` (transições) multiplicam; expressão `volume=volume='…':eval=frame` | ponto de entrada da faixa |
| Keyframes | `keyframeEngine.js:121,226` | `{time_offset_s, value, easing}` por propriedade; só títulos (`tituloRender.js:12`, `playerTextOverlay.js:4`) e o painel do inspetor (`timelineInteraction.js:10636-10660`) leem; **`volume` aparece 0 vezes** | o cabeçalho "suporta áudio" não é verdade hoje: volume não é animável no player nem no render |
| Fade na timeline | `timelineRenderer.js:2206-2240`; `timelineInteraction.js:1815-1840` | alças de duração/curva do bloco `crossfade`; onda desenhada multiplicada por `fadeGain`; `TIMELINE_HISTORY.begin()/commit()` | molde da edição da faixa |
| Onda | `waveformManager.js:101-107,173-216`; `timelineRenderer.js:2186` | picos min/max a 100 Hz (`fetchVideoWaveform`) | serve para desenhar, não para RMS |
| Snap | `timelineInteraction.js:5361` `snapFrame`, `:5386` `snapClip`; `timelineState.js:400,1575` | tolerância 8 px; Alt/Ctrl desligam | candidatas extras = batidas |
| Velocidade no player | `player.js:1236` `setSpeed`; `:4016-4057` `_targetSecondsFor`; `:4094-4175` `_prepareBuffer`; `:4853-5017` áudio | constante: `offsetSec = Δquadros/fps × speed` (4031); `baseRate` 0,1–8 com deriva ±8% (4144-4150), seek duro > 1 s; áudio 0,1–2, **mudo** se produto > 2, reverso ou JKL > 2 (~4898) | `S(t)` troca uma linha; limites atuais valem |
| Velocidade no render | `modelo.py:121-172,450-481`; `grafo_video.py:404-409`; `grafo_audio.py:459-500` | escalar [0,01; 100]; vídeo `reverse` + `setpts=(1/v)*PTS`; áudio `areverse` + `atempo` em [0,5; 2] ou `asetrate` | rampa troca escalar por faixa |
| Sonda do FFmpeg | `ffmpeg.py:243-272` | só encoders de hardware (cache); **nenhuma sonda de filtros** | `rubberband`/`minterpolate` pedem sonda nova |
| Linha de comando | `comando.py:723` | grafo inteiro inline em `-filter_complex` | expressões longas × limite de comando do Windows |
| loudnorm | `audio_chain.py:56,274-275,336-355` | 2 passagens, por mídia (WAV tratado), não na timeline | nivelador é outra coisa (4.3) |
| Transcrição | `schema.py:173` `transcript(video_id, word, start_time, end_time, speaker_id, confidence)`; `:530` `dialogue_word(…start_s, end_s…)` | palavras em tempo da FONTE | origem do ducking |
| Exportação | `otio_export.py:203-295` | `effects` e `keyframes` viajam em `metadata["capiau"]`; **nenhuma** ocorrência de speed/`LinearTimeWarp` | velocidade constante nem sai hoje |
| Preflight | `fidelidade.py:30,68,97,236` | `TIPOS_EFEITO_CONHECIDOS`, `_aviso(nivel, codigo, …)`, `relatorio` | avisos novos em 4.6 |
| Bibliotecas | `requirements.txt:19`; `requirements-nemo.txt:18` | `numpy>=1.26` no `.venv`; `librosa>=0.10` só no `.venv-nemo` | batidas em numpy |

**Invariantes que a frente respeita**
- **E2** (`grafo_audio.py:1-30`): a faixa multiplica **antes** da cadeia, como o fade (regra 2); não cria nó na topologia fechada.
- **P3**: som só de pistas `kind:"audio"`. A faixa de volume mora no clipe de áudio; a `rate` mora nos dois clipes do par (`link_id`) e muda junta [a conferir em `changeClipSpeed`, `timelineState.js:6395`].
- **Regra 3** (WAV tratado começa em 0): `S(t)` soma-se a `baseFonte` (`player.js:4881-4896`); a faixa fica no domínio da timeline, nunca da fonte.
- **Origem da faixa no render** = início AUTORADO (`bordas_s[0]`), não `clipe.inicio_s`, porque `_estender` recua o início para as alças de crossfade (`grafo_audio.py:747`).
- **Paridade**: o clamp 1,0 da tela é replicado (`clip(...,0,1)`); teste do cenário canônico multipista em cascata em todo commit.

## 3. O que o HyperFrames tem
| Peça | HF | Decisão | Nota |
|---|---|---|---|
| Modelo de faixa | `audioAutomation.ts:24,31,33-62,567-592` | **Adaptar** | tempo local, hold nas pontas, versão, teto de pontos (HF 512; Talho 256); sem `curve/viaX/viaY`; valores em ganho linear |
| Volume por tick | `runtime/audioAutomationVolume.ts:1-59` | **Portar a ideia** | o ganho é recalculado a cada tick, sem agendar `AudioParam`: seek e loop saem certos de graça |
| Render do volume | `engine/src/services/audioVolumeEnvelope.ts:1-15` | **Inspirar-se** | HF assa PCM porque `if(lt(t,…))` aninhado estoura em ~95 níveis; medido aqui: falha em 100, ok em 90; soma plana ok até 1000 |
| Ducking | `skills/media-use/scripts/audio-duck.mjs:12-18`, `lib/duck.mjs:1-96` | **Portar** (~80 linhas) | fala = palavras unidas com `merge-gap` 0,6 s; `duck` 0,25; ataque 0,15 s; soltura 0,4 s |
| Voice carve | `audioCarve.ts:1-60,245,597,686,755` | **Adiar** | FFT 4096/2048, 9 centros de 1/3 de oitava (160–6000 Hz), saída = cadeia de *peaking* |
| Nivelador | `audioLeveller.ts:1-55` | **Portar** | janela 4096, piso = pico − 42 dB, correção 0,25 + 0,6×força, ±12 dB, ataque 0,35 s, soltura 0,9 s, ≤ 400 pontos; "não é LUFS"; faixa própria, não toca na do autor |
| Batidas | `audioRhythm.ts:1-40,446,479`; `beats/` | **Portar** para numpy | fluxo espectral em bandas log + autocorrelação + programação dinâmica (Ellis 2007); `STEADY_BEAT_CONFIDENCE = 0.15` |
| `audioSnap.ts` | `:1-62` | **Inspirar-se** | é um alinhador (vizinho mais próximo + relatório), não o snap da interface |
| Rampa | `speedRamp.ts:16,83,101,112,143` | **Portar** | `sourceTimeAt`, `timeAtSourceTime`, `shiftRateLane`, presets; HF integra por tabela (48 células/segmento), o Talho usa fórmula fechada |
| Extração com rampa | `videoFrameExtractor.ts:1338-1398` | **Inspirar-se** | `shiftRateLane` + `sourceTimeAt` para a janela de extração [lido em parte] |
| Limites | `parsers/src/mediaDuration.ts:26-27`; `audioGain.ts:9` | **Adaptar** | taxa 0,1–10 no HF; Talho 0,1–8 (`player.js:4120`); ganho até +12 dB no HF, 0 dB no Talho |

Licença: Apache-2.0 é compatível com GPLv3 [inferência]. Cada módulo portado leva o cabeçalho "Adaptado de HyperFrames, Copyright 2026 HeyGen, Inc., Apache-2.0; portado de TypeScript para Python/JS" e entra na seção de créditos, como na frente A.

## 4. Verificações de viabilidade

### 4.1 Automação de volume — **viável, sem nó novo no grafo e sem GainNode**

| Pergunta | Veredito e evidência |
|---|---|
| Modelo | `clip.keyframes.volume = [{time_offset_s, value, easing}]`; `value` = ganho linear relativo (1,0 = 0 dB); `time_offset_s` local ao clipe (timeline); antes do 1º ponto e depois do último vale o valor da ponta (como `evaluateKeyframes`, `keyframeEngine.js:121-141`); `easing` ∈ {`linear`, `hold`}, outro valor vira `linear` com aviso. Metadados opcionais em `clip.keyframes_meta.volume` (novo: origem, parâmetros, assinatura). Ganho efetivo do clipe = `level × faixa(t)`; o HF faz a faixa **substituir** `data-volume` e desabilita o fader (`audioAutomation.ts:160-166`), aqui os dois multiplicam e o fader continua valendo |
| Edição no canvas | Linha de borracha sobre a onda (`drawWaveform`, `timelineRenderer.js:2186`): clique cria ponto, arrasto move (tempo com `snapFrame`, valor com passo de 0,5 dB), Alt solta o snap, duplo clique/Delete remove; mesmo molde das alças de fade (`timelineInteraction.js:1815-1840`) e `TIMELINE_HISTORY.begin()/commit()`. Eixo em dB com 0 dB a ~80% da altura; a onda é desenhada multiplicada pela faixa, como já faz com `fadeGain` (`:2206-2240`). Diamante no inspetor reaproveita `addOrUpdateKeyframe` (`timelineInteraction.js:10645`) |
| Fade, crossfade, `el.volume` | `finalVol = clamp(pista × level × faixa × fade × forcedGain, 0, 1)` (`player.js:5005-5007`); no render a faixa entra em `extras` de `_estagio_volume` (já multiplicam `(fades)*(extras)` dentro de `clip(...,0,1)`); fade segue **antes** da cadeia (E2, regra 2). Faixa > 1,0 é cortada em 1,0 nos dois lados (preflight `AUTOMACAO_VOLUME_ACIMA_DE_0DB`) |
| Preview | `faixa(t)` calculada a cada chamada de `_syncSingleAudioElement` com `t = (quadro − timelineStartFrame)/fps`: sem estado agendado, portanto **seek, loop, pausa e JKL ≤ 2× saem corretos**; reverso e > 2× já ficam mudos (`player.js:4898`). Cadência real do tick [a medir]; se for 24 Hz, o degrau é visível em rampas < 200 ms e a contramedida é amostrar em `t + meio tick` |
| Render | Soma plana `v0 + Σ Δv·clip((T−ta)/(tb−ta),0,1)` dentro do `volume=…:eval=frame`, precedida de `asetnsamples=n=256:p=0`, com `T=(t+0,002667−offset_ini)`; origem = `bordas_s[0]`. **`nb_samples`/`sample_rate` na expressão zeram o ganho** (NaN→0, medido 0 em todas as amostras); usar constante literal |

Medido (duck 1,0→0,25 em 200 ms, volta em 400 ms; DC 0,5 mono, 6 s):

| Variante | Pico (linear) | Pico (dB) | RMS/100 ms (dB) | Custo 120 s estéreo, 100 pontos |
|---|---|---|---|---|
| quadro 1024 (21 ms), tempo no início | 0,0799 | 2,25 | 0,739 | 0,73 s |
| quadro 1024, tempo no meio | 0,0400 | 1,20 | 0,034 | — |
| `asetnsamples` 480, meio | 0,0188 | 0,63 | 0,008 | — |
| **`asetnsamples` 256, meio (escolhida)** | **0,0100** | **0,34** | **0,004** | **1,13 s (0,9% do tempo real)** |
| `asetnsamples` 128, meio | 0,0050 | 0,17 | 0,005 | — |
| `aeval` por amostra (exato) | 0,0000 | 0,00 | 0,000 | **60,55 s** (80× mais lento) |

Aninhamento: `if(lt…)` aninhado **falha com 100 pontos e passa com 90**; a soma plana passou com 1000 em < 0,1 s [medido]. **Erro máximo aceito**: pico ≤ 0,5 dB e RMS/100 ms ≤ 0,05 dB no render; no player ≤ 0,1 (linear) no pico [a medir]. O fade atual já tem o mesmo degrau de quadro (`fade.py:162`), então a faixa não piora o que existe.

### 4.2 Ducking — **viável; é a primeira geração de faixa e não muda nenhum contrato**

- **Fonte da fala**: palavras de `transcript` (`schema.py:173`, tempo da fonte) → para cada clipe de voz escolhido, `t_timeline = início + (t_fonte − in)/velocidade`, fora de `[in,out]` descartado; clipes reversos ignorados. Sem transcrição: `silencedetect` (`-35 dB`, 0,3 s) sobre o trecho, marcado "aproximado" [inferência: não há VAD no repositório; `grep` por silero/webrtcvad = 0]. Falta confirmar qual tabela (`transcript` ou `dialogue_word`) o app popula (pergunta 2).
- **Algoritmo**: unir palavras com intervalo < `merge_gap` (0,6 s); descartar vão < 0,12 s ou `confidence` < 0,3; para cada fala `[s,e]` emitir pontos `(s−ataque, 1)`, `(s, duck)`, `(e, duck)`, `(e+soltura, 1)`. **Diferença para o HF**: o HF começa o ataque em `s` (`lib/duck.mjs:34-48`), então a primeira sílaba compete com a música; como a análise é offline, o ataque termina em `s`.
- **Parâmetros**: `duck_db` −12 (faixa −6…−24; HF 0,25 = −12 dB, `mixing.md` sugere 0,3–0,4), `ataque_s` 0,15, `soltura_s` 0,4, `merge_gap_s` 0,6, `min_fala_s` 0,12. Faixa simplificada (Douglas–Peucker, 0,3 dB) e ≤ 256 pontos.
- **Estado**: faixa assada e editável; `keyframes_meta.volume = {origem:"ducking", fontes:[ids], params, assinatura}`; a assinatura é o hash das posições das falas; mover/cortar a voz marca "desatualizado" e o botão regera (aviso `DUCKING_DESATUALIZADO`).
- **Ducking × voice carve do HF**: o carve mede as bandas da voz (FFT 4096/2048, centros 160…6000 Hz) e escava a música com filtros *peaking* (`audioCarve.ts:245,755`). O EQ do Talho é fechado: HPF + shelf 250 Hz + peaking 1 kHz Q=1 + shelf 3 kHz (`player.js` `_obterGrafo`; `grafo_audio.py:393-447`), então o carve **não cabe** sem ampliar o contrato E2 (lista de *peaking* de tamanho variável, `audioCadeia.js` da A, `_filtros_eq`, fidelidade). **Ordem recomendada**: (1) ducking por faixa (F4, zero mudança de contrato); (2) carve só depois da A medida no Windows, como bloco novo expandido em *peaking* genéricos (fora desta frente, ~4 dias). A pesquisa anterior diz que o carve "não tem caminho de render novo" — vale para o HF, não para o Talho.

### 4.3 Nivelador — **viável; complementa o loudnorm, não o substitui**

- **Medida**: decodificar o clipe (`ffmpeg -ac 1 -ar 16000`, f32), RMS em janelas de 200 ms, passo 100 ms (numpy); piso = pico − 42 dB (silêncio não sobe); alvo = percentil 50 das janelas de fala; ganho = (alvo − nível) × (0,25 + 0,6 × força), recortado a ±12 dB, suavizado com ataque 0,35 s / soltura 0,9 s; pontos dentro de 0,4 dB removidos; ≤ 256 pontos.
- **Modo da v1: "baixar"** (alvo = percentil 20, ganhos ≤ 0 dB), porque o teto é 0 dB (4.1). "Subir" até +12 dB só depois da A. A faixa vai para `keyframes.volume` (ou para uma segunda faixa `volume_nivelador`, que multiplica; recomendo a segunda, para não sobrescrever o que o Fernando desenhou, como o HF faz com um nó `gain` próprio, `audioLeveller.ts:20-35`).
- **Diferença honesta para o `loudnorm`** (`audio_chain.py:56,336`): o `loudnorm` mede o programa inteiro (EBU R128, ponderação K e gate) e aplica um ganho essencialmente único mais limite de pico [inferência: ler `audio_chain.py:336-355` para confirmar o modo]; ele não iguala frase fraca e frase forte dentro do clipe e roda por mídia, não na timeline. O nivelador mede RMS simples, **não é LUFS** (texto no aviso `NIVELADOR_NAO_E_LUFS`), age dentro do clipe e deixa a curva à vista. Ordem na cadeia: nivelador (faixa) → EQ/dinâmica (E2) → mix → `alimiter` do master (A) → `loudnorm` do master.

### 4.4 Batidas — **viável em numpy no `.venv` principal; librosa só como oráculo de teste**

- **Caminho**: portar `audioRhythm.ts` (505 linhas) para `src/media/ritmo.py` (novo): decodificar 22,05 kHz mono; STFT com `numpy.fft.rfft` (janela 1024, passo 512); fluxo espectral em bandas log; autocorrelação com prior log-normal em ~120 BPM; programação dinâmica de Ellis 2007; compassos 3/4 por heurística (`Downbeats.confidence = "low"`); saída `{bpm, batidas[], tempos_fortes[], confianca, motivo}`. Cache em `data/cache/batidas/<video_id>.json` com `versao` e mtime. Sem batida regular: lista vazia + `motivo`, nunca invenção.
- **Por que não librosa em produção**: vive no `.venv-nemo` (`requirements-nemo.txt:18`, arrasta numba/scipy/sklearn), exigiria worker em outro processo, e o algoritmo cabe em ~250 linhas. Uso: teste que compara com `librosa.beat.beat_track` quando disponível (≥ 90% a ±50 ms), senão `skip`.
- **Onde mostrar**: ticks finos sobre a onda do clipe de áudio (compasso mais alto) e marcas na régua, ligados por clipe ("Batidas" no inspetor); nada abre sozinho.
- **Snap**: as batidas, mapeadas a quadros da timeline `início + (batida − in)/velocidade`, entram como candidatas extras em `snapFrame`/`snapClip` (`timelineInteraction.js:5361,5386`) via `TIMELINE_STATE.snapExtras` (novo) e usam o guia visual existente (`renderer.activeSnapFrame`, `:321`); Alt/Ctrl continuam desligando. O `snapper` do HF (`audioSnap.ts:41`) só serve ao comando em lote "cortar nas batidas".

### 4.5 Rampa de velocidade — **viável; player é o ponto mais incerto**

| Camada | Veredito | Evidência |
|---|---|---|
| Modelo | `clip.keyframes.rate` (multiplicador 0,1–8, `linear`); `S(t) = ∫r` e inversa `T(s)` por fórmula fechada em cada segmento: `T = ta + 2d/(ra + √(max(0, ra² + 2k d)))`, `d = s − S_i`, `k = Δr/Δt` | verificado contra a inversa numérica; HF usa tabela (`speedRamp.ts:101,112`) |
| Player vídeo | **Viável** | só `offsetSec` (`player.js:4031`) vira `S(t)` e `baseRate` (~4119) vira `r(t)`; a correção de deriva (4144-4150) e o seek duro (> 1 s) já existem; reverso (pausa + seek por quadro, ~4125) usa o mesmo mapa. Risco: decodificação a 8× em 1080p no i7-10700 [a medir] |
| Player áudio | **Viável com limite** | `targetSeconds` (4885-4896) usa `S(t)`; `el.playbackRate = r(t)` a cada tick com `preservesPitch`; continua **mudo** acima de 2× (4898); o render tem som. Chromium costuma silenciar fora de 0,25–4 [inferência, conferir no Edge] |
| Render vídeo | **Viável: UM `setpts` em forma fechada**, sem segmentos | soma plana `gte(s,Si)*lt(s,Si+1)*(ta + 2*(s−Si)/(ra+sqrt(max(0,ra²+2k(s−Si)))))` com `s=(PTS*TB)`; 6 pontos = 915 caracteres; **162 de 162 quadros, desvio máx. 0,80 quadro (média 0,34)**, ids monótonos e coerentes com 1×/3×/0,5× [medido]. **Armadilha**: sem `max(0,…)` o termo inativo dá `sqrt(<0)=NaN`, `0*NaN=NaN` e só 57 de 162 quadros sobrevivem [medido] |
| Render áudio | **Viável com condição** | `atempo` em 61 segmentos de 100 ms + `concat`: **6,175 s contra 6,750 s ideais (−575 ms, ~9,4 ms perdidos por junção)** e pior janela de 50 ms em −28,3 dB contra −33,1 dB do `atempo` constante (+4,8 dB) [medido, tom de 440 Hz]. Logo: segmentos só **com duração imposta** (`atrim` + `apad=whole_dur`) e tempo médio por segmento (erro interno ≤ Δr·Δt/8 ≈ 1,3 ms para 0,1 s) |
| `rubberband` | **Inconclusivo, opcional** | existe no FFmpeg do contêiner; `asendcmd` a cada 50 ms: mediana −55,1 dB (melhor que `atempo`), mas p95 −2,4 dB e +62 ms [medido, não investigado]. Só entra após sonda `ffmpeg -filters` (padrão de `ffmpeg.py:243-272`) e nova medida no Windows |
| `minterpolate` | **Opcional, só render** | `minterpolate=mi_mode=mci` é caro em CPU [a medir no i7-10700]; precisa de entrada de taxa constante, logo vai **antes** do `setpts` da rampa; a prévia continua mostrando quadros repetidos (aviso) |
| OTIO/EDL/XML | **Só constante** | o exportador não escreve nem a velocidade constante hoje (`otio_export.py:203-295`). F8 adiciona `LinearTimeWarp` para constante e, para a rampa, divide o clipe em ≥ 6 degraus de velocidade média (erro de fonte nas junções 0) mantendo a faixa em `metadata["capiau"]["keyframes"]` (`:209`) + aviso |

### 4.6 O que entra no preflight (`fidelidade.py`)

| Recurso | Código (novo) | Nível | Quando |
|---|---|---|---|
| Volume | `AUTOMACAO_VOLUME_ACIMA_DE_0DB` | aviso | ponto > 1,0 (cortado em 1,0 na tela e no arquivo) |
| Volume | `AUTOMACAO_EXPORT_PERDIDA` | info | EDL/XML: sem curva de volume (OTIO guarda em `metadata`) |
| Volume | `AUTOMACAO_PONTOS_REDUZIDOS` | info | faixa > 256 pontos simplificada |
| Ducking | `DUCKING_DESATUALIZADO` / `DUCKING_SEM_TRANSCRICAO` | aviso | assinatura difere / fala por `silencedetect` |
| Nivelador | `NIVELADOR_NAO_E_LUFS` | info | sempre que há faixa de nivelador |
| Batidas | `BATIDAS_SEM_CONFIANCA` | info | confiança < 0,15 (sem batida regular) |
| Rampa | `RAMPA_AUDIO_MUDO_NA_PREVIA` | info | `r(t)` > 2 em algum ponto: prévia muda, arquivo com som |
| Rampa | `RAMPA_TOM_CORRIGIDO` / `RAMPA_FORA_DO_LIMITE` | info / aviso | tom forçado; taxa fora de 0,1–8 cortada |
| Rampa | `RAMPA_EXPORT_ESCADA` | aviso | OTIO/EDL/XML recebem degraus |
| Rampa | `RAMPA_REVERSO_MEMORIA` | aviso | `reverse` do FFmpeg carrega o trecho inteiro (já é assim, clipes longos) |
| Comando | `GRAFO_EM_ARQUIVO` | info | grafo > 20 000 caracteres vai para script (`comando.py:723`) |

## 5. Decisões de projeto
| # | Decisão | Alternativas (prós e contras) | Recomendação |
|---|---|---|---|
| DF1 | Onde mora a faixa | (a) `clip.keyframes.<alvo>` reaproveitado: já persiste, já viaja ao OTIO (`otio_export.py:209`), undo por snapshot, diamante do inspetor; as curvas de easing dos títulos não existem no FFmpeg. (b) `clip.automation` novo à la HF: versão e metadados nativos, mas um segundo modelo de animação ao lado de `keyframes`. (c) `points` dentro do bloco `volume`: bypass por `disabled`, mas não serve à `rate` | **(a)** com easing restrito a `linear`/`hold` e `keyframes_meta` opcional |
| DF2 | Unidade e interpolação | ganho linear (igual a `level` e ao fade) ou dB | **linear armazenado**, dB só na tela (eixo e rótulo) |
| DF3 | Render do volume | (a) soma plana + `asetnsamples=256`: 0,34 dB, 0,9% do tempo real. (b) assar PCM como o HF: exato, mas pré-passe de disco e quebra o grafo único. (c) `aeval`: exato, 80× mais lento. (d) `amultiply` com WAV de envelope: rápido, arquivo extra por clipe | **(a)**; (b) só se a faixa passar de 1000 termos |
| DF4 | Preview do volume | (a) `el.volume` por tick, como o fade. (b) GainNode agendado: suave, mas só existe com a cadeia ao vivo (`createMediaElementSource` é permanente por elemento, `player.js` `_obterGrafo`) e precisa invalidar em seek/loop (HF desistiu, `audioAutomationVolume.ts:1-9`). (c) híbrido | **(a)**; (c) em v2 se o degrau do tick incomodar |
| DF5 | Teto de ganho | 0 dB (hoje) ou +12 dB (HF) | **0 dB** na v1; acima disso exige nó `vol` na cadeia da A e `clip(…,0,3,98)` no render |
| DF6 | Ducking | (a) palavras → faixa assada + assinatura de "desatualizado". (b) ducking vivo derivado das pistas no player e no render: segue as edições, mas exige a transcrição no frontend e paridade dupla. (c) `sidechaincompress`: dispensa transcrição, mas reage ao vazamento da música e não é editável | **(a)** |
| DF7 | Batidas | numpy no `.venv`; librosa em worker (pesado); biblioteca nova | **numpy**; librosa só como oráculo de teste |
| DF8 | Rampa no vídeo | `setpts` fechado (medido); segmentos `trim`+`setpts`+`concat` (junções, N filtros, quadro fracionário); `minterpolate` | **`setpts` fechado** |
| DF9 | Rampa no áudio | (a) `atempo` por segmentos com duração imposta; (b) `rubberband`+`asendcmd` (mediana melhor, p95 ruim, depende da build); (c) varispeed em numpy (exato, tom de fita, pré-passe); (d) sem áudio | **(a)** na v1, tom corrigido forçado; (b) só após sonda + medida no Windows |
| DF10 | Interpolação da taxa | linear (medida) ou logarítmica (HF; `ln(1+λd/r)/λ` também é fechada, não medida) | **linear**; campo `interp` por ponto depois, se a rampa parecer brusca |
| DF11 | Comando longo | manter inline; `-filter_complex_script` acima de 20 000 caracteres (FFmpeg ≥ 7 prefere `-/filter_complex` [inferência]) | **script de arquivo acima do limite**, escolhido pela versão do FFmpeg detectada |
| DF12 | Faixa × edição do clipe | acompanha o conteúdo (trim de cabeça desloca −Δ, corte divide com ponto de fronteira, mover não muda) ou fica fixa na timeline | **acompanha**; vale também para o ducking (a posição em timeline das falas não muda no trim) |

## 6. Modelo de dados e compatibilidade

```json
"keyframes": {
  "volume":           [ {"time_offset_s": 0.0, "value": 1.0,  "easing": "linear"}, {"time_offset_s": 12.0, "value": 0.25, "easing": "linear"} ],
  "volume_nivelador": [ … ],
  "rate":             [ {"time_offset_s": 0.0, "value": 1.0, "easing": "linear"}, {"time_offset_s": 1.5, "value": 3.0, "easing": "linear"} ]
},
"keyframes_meta": { "volume": {"origem": "ducking", "fontes": ["c12"], "params": {"duck_db": -12}, "assinatura": "sha1…"} }
```

- **Regras** (JS e Python iguais): ordenar por tempo; tempos repetidos colapsam; `time_offset_s` ≥ 0; ≤ 256 pontos (simplifica, nunca falha); `volume` e `volume_nivelador` ∈ [0, 1]; `rate` ∈ [0,1; 8]; `easing` fora de `linear`/`hold` vira `linear`; antes do 1º e depois do último ponto vale o valor da ponta. Fonte única de verdade numérica: `tests/dados/automacao_ouro.json` (novo), gerado pelo JS e lido pelo pytest.
- **`sequence_json` v2**: nenhum campo obrigatório novo. Sem `keyframes.volume`/`rate` o comportamento e a string do filtro são idênticos aos de hoje (teste congelado nos cenários de `tests/test_render_grafo_audio_transicao.py` e no canônico). Talho antigo ignora a chave e toca sem automação (degrada sem quebrar). `modelo.normalizar` ganha `Clipe.faixas`; `duracao_s` e `trecho_fonte` usam `T(out−in)`/`S(·)` só quando há `rate`.
- **Velocidade**: com `rate`, `cut.speed` vira valor nominal e a faixa tem precedência; "definir velocidade constante" apaga a rampa depois de perguntar; par ligado (`link_id`) recebe a mesma faixa.
- **Edição**: trim de cabeça `deslocar(−Δ)`; corte `dividir(τ)` insere o valor interpolado em τ nos dois lados; duplicar copia; `changeClipSpeed` não escala a faixa de volume (domínio da timeline, como o fade).
- **Parâmetros de efeito (depois)**: chaves `fx.audio_eq.low`, `fx.audio_dynamics.makeup_db` etc. no mesmo mapa, só para parâmetros contínuos do E2 (EQ e makeup); gate e compressor ficam de fora (o HF também não os automatiza, `mixing.md`). Exigem `setValueAtTime` ao vivo e `asendcmd` ou segmentação no render, por isso estão fora desta frente.
- **Exportação**: OTIO leva a faixa em `metadata["capiau"]["keyframes"]` (já existe); velocidade constante passa a sair como `LinearTimeWarp`; rampa sai em ≥ 6 degraus de velocidade média, com aviso; EDL/XML sem curva de volume (aviso `AUTOMACAO_EXPORT_PERDIDA`). Round-trip por OTIO preserva a faixa; por XML/EDL não.
- **Banco e configuração**: sem migração; cache novo `data/cache/batidas/` (versionado por `versao`); rotas novas devolvem pontos e o frontend grava (undo); padrões do ducking/nivelador são constantes em `audio_analise.py`, sem chave obrigatória em `settings_registry.py`.

## 7. Mudanças por arquivo

| Arquivo | Mudança | Etapa |
|---|---|---|
| `src/ui/js/automacaoFaixa.js` (novo) | `normalizar`, `amostrar` (busca binária), `integralTaxa` (S), `inversaTaxa` (T), `deslocar`, `dividir`, `simplificar`; sem DOM; cabeçalho HF | F0, F7 |
| `src/export/video_render/automacao.py` (novo) | espelho Python + `expressao_volume`, `expressao_setpts_rampa`, `segmentos_atempo` | F0, F1, F8 |
| `src/media/audio_analise.py` (novo) | decodificação f32, RMS em janelas, `silencedetect`, ducking e nivelador (puros, numpy) | F4, F5 |
| `src/media/ritmo.py` (novo) | batidas, andamento, compasso, cache | F6 |
| rota nova (pasta de rotas a confirmar) | `POST /api/audio/ducking`, `POST /api/audio/nivelador`, `GET /api/audio/batidas/{id}` | F4–F6 |
| `keyframeEngine.js:121` | caminho rápido para faixas de áudio; easing restrito | F0 |
| `player.js:4979-5008, 4885-4896, 4962-4966` | fator `faixa(t)` no produto; `S(t)` e `r(t)` no áudio | F2, F7 |
| `player.js:4031, ~4119` | `_targetSecondsFor` e `baseRate` com rampa | F7 |
| `timelineRenderer.js:2186-2260` | `desenharFaixa` (novo): linha, pontos, onda × faixa, ticks de batida | F3, F6 |
| `src/ui/js/timelineFaixa.js` (novo) | hit-test, arrasto, inserção e remoção de pontos e desenho da linha; chamado por 3 ganchos mínimos em `timelineInteraction.js` e `timelineRenderer.js` | F3, F7 |
| `timelineInteraction.js:1815-1840 (molde), 5361/5386, 10636-10660` | hit-test, arrasto, Delete; candidatas de snap; diamante | F3, F6 |
| `timelineState.js:2856, 5908, 6050, 6395` | trim desloca; corte divide; `changeClipSpeed` pergunta e propaga ao par | F3, F7 |
| `modelo.py:121-172, 450-481` | `Clipe.faixas`; `duracao_s`/`trecho_fonte` com `S/T` | F1, F8 |
| `grafo_audio.py:328-390, 459-500, 501-580` | faixa em `extras` (origem `bordas_s[0]`); `asetnsamples` só com faixa; retime em segmentos com duração imposta | F1, F8 |
| `grafo_video.py:404-409` | `setpts` fechado da rampa | F8 |
| `comando.py:723` | script de filtros acima de 20 000 caracteres | F1 |
| `fidelidade.py:30,68,97` | códigos de 4.6 | F1–F8 |
| `otio_export.py:203-295` | `LinearTimeWarp` e degraus | F8 |
| `tests/` | `test_automacao_faixa.py`, `autoteste_automacao_faixa.mjs`, `test_render_automacao_volume.py`, `autoteste_player_automacao_volume.mjs`, `test_ducking.py`, `test_nivelador.py`, `test_ritmo.py`, `test_render_rampa.py`, `autoteste_player_rampa.mjs`; cenários B `audio_automacao_volume` e `velocidade_rampa` | todas |

## 8. Etapas
| Etapa | Commit | Conteúdo | Testes | Dias | Dep. |
|---|---|---|---|---|---|
| F0 | `feat(automacao): modelo de faixa com amostragem única em JS e Python` | `automacaoFaixa.js`, `automacao.py`, tabela ouro | \|Δ\| ≤ 1e-9 em 1000 pontos; hold; teto 256; easing; S/T inversas | 1,0 | — |
| F1 | `feat(render): automação de volume no estágio de entrada do áudio` | faixa em `extras`, `asetnsamples=256`, centragem, `bordas_s[0]`, script de filtros, avisos | string congelada sem faixa; `audio_automacao_volume` (RMS ± 0,05 dB); faixa + crossfade; cascata | 1,5 | F0 (A opcional) |
| F2 | `feat(player): volume automatizado no áudio do clipe` | fator no produto; medir cadência do tick | autoteste DOM falso: seek, loop, pausa, JKL; cascata | 1,5 | F0 |
| F3 | `feat(timeline): faixa de volume desenhada e editável sobre a onda` | canvas, hit-test, snap, undo, diamante; trim/corte/duplicar | autoteste de interação; corte e trim preservam a curva; cascata | 3,0 | F0, F2 |
| F4 | `feat(audio): ducking da música a partir da transcrição` | `audio_analise.py`, rota, botão, meta + assinatura | fixture de 3 falas; sem transcrição; desatualizado | 2,0 | F3 |
| F5 | `feat(audio): nivelador por RMS em janelas` | rota, botão, faixa `volume_nivelador` | tom modulado; ±12 dB; ≤ 256 pontos | 1,5 | F3 |
| F6 | `feat(audio): batidas por numpy, ticks na onda e snap` | `ritmo.py`, cache, ticks, `snapExtras` | clique 120 BPM; oráculo librosa; snap | 3,0 | F3 |
| F7 | `feat(player): rampa de velocidade com tempo da fonte integrado` | `S/T`, `_targetSecondsFor`, `_prepareBuffer`, áudio, UI mínima (presets + pontos), par ligado | alvo por quadro = `sourceTimeAt`; deriva ≤ 2 quadros [a medir]; reverso | 3,0 | F0, F3 |
| F8 | `feat(render): rampa de velocidade no vídeo, no áudio e na exportação` | `setpts` fechado, segmentos com duração imposta, `modelo.py`, OTIO em degraus, avisos | `velocidade_rampa`; sincronia A/V ≤ 20 ms; OTIO | 3,5 | F7, B |
| **Total** | | | | **20,0** | |

Marcos úteis: M1 = F0–F3 (7 dias, volume completo); M2 = F4–F5 (3,5 dias); M3 = F6 (3 dias); M4 = F7–F8 (6,5 dias). F9 (opcional, 4–6 dias, fora do total): `rubberband` e `minterpolate` com sonda de filtros, voice carve, ganho acima de 0 dB.

## 9. Testes e medições
| Teste | Como | Número-alvo | Estado |
|---|---|---|---|
| Deriva da amostragem JS × Python | `tests/dados/automacao_ouro.json` (valor, S, T) | \|Δ\| ≤ 1e-9 em 1000 pontos aleatórios | novo |
| Identidade sem faixa | string congelada de `cadeia_clipe_audio` nos cenários existentes e no canônico | igualdade exata | novo |
| Render do volume | DC 0,5, duck 1,0→0,25 em 200 ms, volta em 400 ms | pico ≤ 0,5 dB; RMS/100 ms ≤ 0,05 dB | **medido 0,34 dB / 0,004 dB** |
| Custo do render | 120 s estéreo, 100 pontos | ≤ 2% do tempo real | **medido 0,9%** |
| Faixa + fade + crossfade | cenário B `audio_automacao_volume`; null test: faixa constante 1,0 = sem faixa | \|Δ\| ≤ 1e-6 | novo |
| Comando longo | 10 clipes × 100 pontos | < 32 767 caracteres ou script de arquivo | novo |
| Player: volume | autoteste DOM falso: `el.volume` após seek, loop, pausa = `faixa(t)`; no Edge, contar chamadas por segundo | \|Δ\| ≤ 1e-6; cadência [a medir] | novo |
| Ducking | transcrição sintética de 3 falas (0,5–2,0 s, 2,3–3,4 s, 8–9 s), música constante | ganho em `s` = duck ± 0,5 dB; vão de 0,3 s não solta; sem transcrição usa `silencedetect` | novo |
| Nivelador | tom 440 Hz em frases de 2 s a −30, −18, −24, −12 dBFS | desvio do RMS por frase −40%; ganhos em [−12; 0]; ≤ 256 pontos | novo |
| Batidas | clique a 120 BPM (30 s), 90 BPM, ruído branco | BPM ± 0,5%; ≥ 95% a ±30 ms; ruído → lista vazia; ≤ 0,5 s por minuto de áudio [a medir]; librosa ≥ 90% a ±50 ms | novo |
| Rampa no player | autoteste: alvo por quadro = `sourceTimeAt`; no Edge, deriva em rampa 1→3× | \|Δ\| ≤ 1e-6 s; deriva ≤ 2 quadros após 0,5 s, zero seek duro [a medir] | novo |
| Rampa no vídeo | `velocidade_rampa`: `testsrc` + `geq` com o id do quadro (como `medir_ffmpeg3.py`) | quadros = `round(T_fim × fps)` ± 1; desvio ≤ 1,0 quadro | **medido 162/162, 0,80** |
| Rampa no áudio | tom 440 Hz, mesma faixa | duração = ideal ± 20 ms; pior janela de 50 ms ≤ referência + 6 dB | hoje −575 ms e +4,8 dB (sem duração imposta) |
| Sincronia A/V | clique de áudio × quadro de flash | ≤ 20 ms ao fim do clipe | novo |
| OTIO | reabrir com `otio` | `LinearTimeWarp` presente; duração ± 1 quadro | novo |
| Cascata | `tests/test_render_composicao_multipista_cascata.py` e `tests/autoteste_composicao_multipista_cascata.mjs` | passam em todo commit | existente |

**Medições no Windows do Fernando (script de ~5 minutos, antes de F2 e F7):** cadência do tick de `_syncSingleAudioElement`; faixa de taxa em que o Edge deixa o `<audio>` mudo; deriva e seeks com `rate` 1→3×; decodificação a 8× em 1080p; `ffmpeg -version` e `-filters` (rubberband, minterpolate, asetnsamples); tempo do `minterpolate`; comprimento máximo de comando aceito.

## 10. Critérios de aceite

- [ ] Curva de volume desenhada no clipe de áudio, ouvida no Program e exportada: RMS por janela de 100 ms do arquivo = curva ± 0,05 dB.
- [ ] Seek, loop, pausa e JKL ≤ 2× deixam o volume certo; reverso e > 2× seguem mudos na prévia, com aviso.
- [ ] Clipe sem faixa: string do filtro idêntica à atual; cenário canônico em cascata passa (pytest e Node) em todos os commits.
- [ ] Faixa + fade + crossfade no mesmo clipe: o produto bate na tela e no arquivo (cenário B).
- [ ] Mover preserva a faixa; aparar a cabeça e cortar mantêm a curva no conteúdo; desfazer e refazer funcionam.
- [ ] Ducking em um clique: música ≥ 10 dB abaixo já no início da fala; mover a voz marca "desatualizado".
- [ ] Nivelador reduz o desvio por frase em ≥ 40% no fixture e avisa que não é LUFS.
- [ ] Batidas: 120 BPM sintético dentro de 0,5%, ≥ 95% a ±30 ms; sem batida regular → lista vazia com motivo; Alt/Ctrl desligam o snap.
- [ ] Rampa: 162/162 quadros em `velocidade_rampa`, desvio ≤ 1,0 quadro, sincronia A/V ≤ 20 ms, deriva do player ≤ 2 quadros.
- [ ] Preflight emite os códigos de 4.6; OTIO sai com `LinearTimeWarp` e a rampa em degraus.
- [ ] Os números do contêiner foram refeitos no Windows e registrados na mensagem do commit.

## 11. Riscos e mitigação

| Risco | Prob./impacto | Mitigação |
|---|---|---|
| Números do contêiner (FFmpeg 6.1.1, Chromium) diferem do Windows/Edge | alta / média | script de medição de 5 min antes de F2 e F7; limiares em constantes; itens [a medir] explícitos |
| Degrau do tick (24 Hz?) audível em rampas curtas | média / baixa | amostrar em `t + meio tick`; subida mínima de 100 ms no editor; GainNode na v2 |
| Regressão em `timelineInteraction.js` (13,8 mil linhas) e `timelineState.js`, onde outra sessão também mexe | alta / alta | lógica em módulo novo `timelineFaixa.js` com 3 ganchos mínimos; commit só dos seus trechos; cascata em cada commit |
| Transcrição com tempo errado ou palavra faltando solta a música no meio da fala | média / média | `merge_gap`, `min_fala_s`, confiança mínima, faixa editável, aviso de aproximação; testar com um vídeo real |
| Rampa no player: decodificação a 8× e seeks duros engasgam | média / média | limites atuais (0,1–8); presets sem picos longos; medir no i7-10700 |
| `atempo` por segmentos: −9 ms por junção e cliques [medido] | alta / alta | duração imposta por segmento e medida; `rubberband` só após sonda e nova medida |
| Linha de comando acima do limite do Windows | média / alta | script de filtros; teste com 10 × 100 pontos; aviso `GRAFO_EM_ARQUIVO` |
| FFmpeg ≥ 7 no Windows e `-filter_complex_script` | baixa / média | detectar a versão; `-/filter_complex` quando ≥ 7 [inferência] |
| `_estagio_volume` é compartilhado com a frente A | média / média | F1 só acrescenta em `extras`; string congelada; revisar junto da A |
| Faixa e rampa em par ligado ficam diferentes | média / alta | propagar em `changeClipSpeed` e no corte; teste de par ligado |
| Licença e crédito do HyperFrames | baixa / baixa | cabeçalho nos módulos portados e seção de créditos |

## 12. Perguntas para o Fernando
| # | Pergunta | Recomendação |
|---|---|---|
| 1 | Precisa reforçar volume acima de 0 dB (trecho baixo) agora? | Não: teto 0 dB como hoje; +12 dB depois da frente A |
| 2 | Qual tabela de palavras seu app preenche: `transcript` ou `dialogue_word`? | Usar `transcript` e cair para `dialogue_word`; confirmar no seu banco |
| 3 | Ducking padrão: −12 dB, ataque de 0,15 s terminando no início da fala, soltura de 0,4 s, vão de 0,6 s? | Começar assim e ajustar de ouvido numa cena real |
| 4 | A faixa deve acompanhar o conteúdo ao aparar a cabeça e cortar? | Sim; mover o clipe não muda a faixa; ducking vira "desatualizado" se a voz se mover |
| 5 | Nivelador só abaixa na v1 (alvo = falas mais baixas)? | Sim; "subir" com a frente A |
| 6 | Batidas: ticks na onda e na régua, snap só com "Batidas" ligado no clipe? | Sim; snap desligado por padrão |
| 7 | Rampa linear ou logarítmica; quais presets? | Linear e 3–4 presets do HF (`speedRamp.ts:143`) depois de você vê-los |
| 8 | Tom na rampa: forçar correção de tom (nada de "som de fita") na v1? | Forçar |
| 9 | Prévia muda acima de 2× (como hoje) com som no arquivo final? | Aceitar, com aviso |
| 10 | OTIO/XML/EDL: rampa em degraus de velocidade média e volume sem curva (com aviso)? | Sim |
| 11 | Vale ampliar o EQ (contrato E2) com bandas *peaking* para o voice carve? | Não agora; só depois da A medida |
| 12 | Posso pedir um script de medição de 5 minutos no seu PC antes de F2 e F7? | Sim |

## 13. Prompt para o chat de implementação

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> Faça depois do plano B (harness de regressão) se quiser os dois cenários de render; F0–F6 não dependem dele. Ganho acima de 0 dB só depois da frente A.

---

Quero no CapIAu Talho volume automatizado por clipe (curva sobre a onda), ducking da música sob a voz, nivelador de fala, batidas da música com snap e rampa de velocidade, com o player e o arquivo exportado iguais. Leia antes, nesta ordem: `docs/PESQUISA_HYPERFRAMES.md` (4.6), `.agents/rules/nle-parity-and-media-lifecycle.md`, a docstring de `src/export/video_render/grafo_audio.py` (contrato E2 e as 3 regras) e o plano da frente F (seções 4, 5, 6 e 8). Confira no código cada afirmação; linhas podem ter andado.

### O que já existe (conferido em 28/10/2026, commit 9cba1b2)
- Volume não é animável: `keyframeEngine.js` não cita `volume`; o player usa `el.volume = clamp(pista × level × fade × forcedGain, 0, 1)` (`player.js:5008`) e o render, o mesmo produto em `grafo_audio.py:328` (`_estagio_volume`, parâmetro `extras`).
- Keyframes `{time_offset_s, value, easing}` só são lidos por títulos e pelo painel do inspetor (`timelineInteraction.js:10636`); já viajam ao OTIO em `metadata["capiau"]` (`otio_export.py:209`).
- Velocidade é escalar: `player.js:4031` (`_targetSecondsFor`), `:4094` (`_prepareBuffer`), `:4853` (áudio, mudo acima de 2×); render em `modelo.py:121`, `grafo_video.py:409`, `grafo_audio.py:473`. O OTIO nem exporta a velocidade constante.
- Palavras em `transcript` (`schema.py:173`) e `dialogue_word` (`:530`). `numpy` no `.venv`; `librosa` só no `.venv-nemo`. O Talho não sonda filtros do FFmpeg (`ffmpeg.py:243` só encoders). O grafo vai inline em `comando.py:723`.
- Medido no contêiner (FFmpeg 6.1.1): `volume=…:eval=frame` com `asetnsamples=n=256:p=0` e tempo no meio do quadro dá 0,34 dB de pico; `if` aninhado falha com 100 pontos, soma plana passa com 1000; `setpts` fechado com `max(0,…)` acertou 162 de 162 quadros (desvio 0,80); `atempo` em segmentos sem duração imposta perde ~9 ms por junção. Reproduza no meu Windows antes de F2 e F7.

### O que fazer, em ordem (um commit por etapa; conventional commits em português)
1. **F0** `feat(automacao): modelo de faixa com amostragem única em JS e Python`: `src/ui/js/automacaoFaixa.js` e `src/export/video_render/automacao.py` (cabeçalho "Adaptado de HyperFrames, Copyright 2026 HeyGen, Inc., Apache-2.0"), tabela `tests/dados/automacao_ouro.json`; teste \|Δ\| ≤ 1e-9.
2. **F1** render: faixa em `extras` de `_estagio_volume`, `asetnsamples=n=256:p=0`, tempo no meio do quadro com constante literal (nunca `nb_samples`), origem `bordas_s[0]`, script de filtros acima de 20 000 caracteres, avisos de 4.6; string idêntica sem faixa.
3. **F2** player; **F3** timeline (módulo `timelineFaixa.js` com 3 ganchos); **F4** ducking; **F5** nivelador; **F6** batidas; **F7** rampa no player; **F8** rampa no render e na exportação (detalhes e números no plano).
4. Depois de cada etapa: `pytest tests/test_render_composicao_multipista_cascata.py` e `node tests/autoteste_composicao_multipista_cascata.mjs`, mais os testes novos da etapa.

### Pergunte antes de decidir
Tabela de palavras (`transcript` ou `dialogue_word`); teto de 0 dB; parâmetros do ducking; rampa linear ou log; tom forçado; degraus na exportação (plano, seção 12).

### Regras deste repositório
- Leia o `CLAUDE.md` da pasta `dev` e `docs/HANDOFF_DESIGN_UI.md`. Interface: 9–12 px, botões 20–28 px, `var(--fs-N)`, `var(--sp-N)`, `--accent`; nada abre sozinho.
- Outra sessão mexe na interface (`player.js` e `timelineInteraction.js` às vezes). Commit só dos seus trechos (índice montado a partir do HEAD), direto na main, sem coautoria, sem push; confira o `git status` antes.
- Autotestes Node ESM com DOM falso em `tests/autoteste_*.mjs`; pytest em `tests/test_*.py`; scripts de edição em arquivo, com `PYTHONUTF8=1`; servidor de teste `capiau-server-venv` (8022).
- Português, direto. Verifique antes de afirmar. O som muda de propósito onde há faixa: diga-me o que mudou.

### Pronto quando
Desenho uma curva de volume, ouço no Program e o arquivo bate (±0,05 dB por janela de 100 ms); o botão de ducking baixa a música sob a voz; as batidas aparecem e o snap as encontra; a rampa 1×→3×→0,5× sai com vídeo e áudio em sincronia (≤ 20 ms); o cenário canônico em cascata passa em todos os commits.
