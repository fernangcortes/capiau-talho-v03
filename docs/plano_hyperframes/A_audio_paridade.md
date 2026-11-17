# Frente A — Áudio do export pelo mesmo grafo WebAudio do player

> **Resumo.** Os clipes com gate ou compressor passam a sair do **mesmo grafo WebAudio do player**: um módulo `audioCadeia.js` (novo) é usado pelo player e por uma página `render_audio.html` (novo) que roda num `OfflineAudioContext` pela base de navegador da D1; o FFmpeg segue cortando, retemporizando, aplicando volume × fade × crossfade (antes da cadeia, como no player) e mixando.
> Valor: o arquivo de hoje diverge bem mais do que o banner diz. Medido: o compressor sai de 0,6 a 19 dB mais baixo que na tela conforme o nível (os "2,06 dB" não se reproduzem), o EQ erra até 2 dB, mono sai 3 dB mais baixo e o arquivo não tem os 6 ms de latência do compressor da tela. Com o grafo único, janelas × render inteiro dá 0 amostras diferentes em 57,6 milhões, e ao vivo × offline dá 0 depois de ~200 ms.
> Esforço ≈ 11,5 dias (13,5 com a continuidade em cortes de navalha) [inferência]. Depende da D1, etapas 1 e 2 (a 3 é recomendada); a Etapa 0 (EQ e mono no FFmpeg) não depende.
> Principal risco: todos os números vêm do contêiner Linux (Chromium 141, FFmpeg 6.1.1), não do Windows com Edge; e o som muda de propósito: masters novos com compressor ficam mais altos que os antigos.
> Decisão principal: roteamento por necessidade. Só clipes com gate ou compressor ativos vão ao navegador (EQ-only fica no FFmpeg, com o Q corrigido); o FFmpeg atual vira reserva com avisos refeitos; os dois avisos só somem depois da medida no Windows.

Convenções: **[lido]** conferido no código; **[inferência]** dedução minha; **[a medir]** falta teste; **[medido]** número obtido por mim em experimentos desta análise (rascunho fora do repositório) (contêiner Linux, Intel Xeon 2,1 GHz, 4 vCPU, Chromium 141.0.7390.37 do Playwright, FFmpeg 6.1.1; sinais sintéticos de "fala", não fala real); **[web: URL]** fonte externa. `HF:` = HyperFrames v0.8.185 (Apache-2.0, "Copyright 2026 HeyGen, Inc."); `D1:` = `D1_navegador.md`. Estado do Talho conferido em 28/10/2026, commit `9cba1b2`. Nenhum número abaixo é medida do Windows do Fernando.

## 1. Objetivo e valor

O Program toca a cadeia `fonte → volume → hpf → low → mid → high → gate → compressor → makeup` em WebAudio (`src/ui/js/player.js:5254-5435`). O render a reescreve em filtros FFmpeg (`grafo_audio.py:393-447`) e, para compressor e gate, não existe filtro equivalente. Esta frente faz o arquivo usar **o mesmo código** do player nos clipes em que isso importa, e troca "paridade" como texto de aviso por paridade como teste automático (null test).

O que o Fernando ganha [medido], detalhe em 4.10:

| Divergência do FFmpeg atual | Medida | Depois |
|---|---|---|
| Compressor, ganho estático (mesmo limiar e razão; 4 ajustes) | FFmpeg − Chromium: −0,6 a −6,2 dB em −30 dBFS; −1,7 a −12,7 dB em −18 dBFS; −8,5 a −19,4 dB em 0 dBFS | 0 (mesmo nó) |
| Compressor em sinal de fala sintético | arquivo −10,5 dB (limiar −24, 3:1) e −15,9 dB (−30, 4:1) mais baixo que a tela | 0 |
| Gate | pico da diferença −16,5 dBFS nas transições (detector por amostra × por bloco de 128) | 0 |
| EQ | HPF até 1,0 dB; shelves até 1,1 dB (±6) e 2,0 dB (±12) | −93,6 dBFS RMS com o Q corrigido (Etapa 0) |
| Mono | `aformat=...stereo` dá −3,01 dB; a tela dá 0 dB | 0 (Etapa 0) |
| Latência do compressor | 288 quadros (6 ms) na tela, 0 no arquivo | compensada |

O `TEXTO_JOELHO_COMPRESSOR` (`fidelidade.py:47-53`: "2,1 dB no limiar, cai a zero nos extremos") não bate com estas medidas. A medição original (`scratch/render_agentes/audio_b/`) não está no repositório; não consegui reproduzir o 2,06.

Fora do escopo: reverb/delay (o Talho não tem), automação de volume (item 4.6 da pesquisa), trocar a mixagem ou o crossfade do FFmpeg, e qualquer mudança de comportamento do player.

## 2. Estado atual no Talho
### 2.1 O que existe [lido]

| Peça | Onde | O que faz |
|---|---|---|
| Contexto ao vivo | `player.js:5206-5218` | `new AudioContext({ latencyHint: "interactive" })`, sem `sampleRate`: usa a taxa do dispositivo |
| Estado e grafos | `player.js:5191-5204` | `grafos: new WeakMap()` por elemento `<audio>`; a fonte nunca é criada duas vezes |
| Normalização | `player.js:5254-5275` | `_efeitosAudioAoVivo`: `eqOn`/`dynOn` = bloco existe e não é `disabled`; hpf 0–20000, ganhos ±12, gate −90–0 (padrão −45), razão 1–20 (2), limiar −60–0 (−18), makeup ±12 |
| Nós | `player.js:5282-5315` | `highpass` (Q padrão), `lowshelf` 250 Hz, `peaking` 1000 Hz Q 1, `highshelf` 3000 Hz, `DynamicsCompressorNode` (só limiar e razão mudam: joelho 30 dB, ataque 3 ms, release 250 ms), `GainNode`; `createMediaElementSource` (5307) |
| Topologia | `player.js:5342-5350`, `5356-5398` | ordem fechada; blocos neutros saem; religa sem recriar nós |
| Gate | `audioGateWorklet.js:1-71`; carga `player.js:5229-5247` | pico absoluto do bloco de 128 amostras no canal 0; alvo binário; one-pole 5 ms (abre) e 80 ms (fecha); ganho nasce em 1,0; `addModule("js/audioGateWorklet.js")` (5235) |
| Volume × fade | `player.js:4976-5008` | `el.volume = clamp(pista × clipe × fade × ganhoDaTransição, 0, 1)`; 0 se pista muda, clipe desligado, velocidade > 2 ou reverso |
| Crossfade | `player.js:5043-5071` | janela [corte − halfA, corte + halfB]: dois elementos (`audioPool` e `audioTransitionPool`), curva `equal_power` por quadro |
| Render FFmpeg | `grafo_audio.py:393-447` | `highpass width=1`, `bass/treble width=0.7071`, `equalizer width=1`; `agate ratio=9000:attack=5:release=80:knee=1:detection=peak:range=0`; `acompressor attack=3:release=250:knee=8`; `volume=XdB` |
| Ramo do clipe | `grafo_audio.py:501-574` | `atrim → asetpts → retime → volume/fade → eq → dinâmica → adelay → apad` |
| Mixagem | `grafo_audio.py:768-889` | `amix normalize=0` por pista e total; `aresample 48000, aformat fltp estéreo, alimiter` |
| Avisos | `fidelidade.py:47-65`, `165-190` | `JOELHO_COMPRESSOR_LIMITADO` e `DETECTOR_GATE_DIVERGENTE` (este atrás de `EXIBIR_AVISO_GATE`) |
| Execução | `execucao.py:412-603` | `_render_job`: fontes → destino → comandos → títulos (505-526) → laço de `montar_comando` (528-546) → concat; `finally` fecha o navegador (601-603) |
| Comando | `comando.py:309-317`, `423`, `547-553` | `_chamar_grafo_audio`; entradas com caminho pronto (`titulo`, `cor`, `lavfi`); `montar_comando(..., titulos=None)` |

### 2.2 Invariantes que não podem quebrar

1. **Ordem E2 fechada**; blocos desligados saem da lista (`grafo_audio.py:3-14`, `player.js:5342-5350`).
2. **Volume × fade entram ANTES da cadeia** (`grafo_audio.py:25-29`). Confirmado [medido]: `el.volume` 1 / 0,5 / 0,25 baixa a entrada do grafo −6,02 / −12,04 / −18,06 dB; `muted` zera; fonte mono entra com 1 canal.
3. **WAV tratado começa em zero** e tem só [in, out] (`grafo_audio.py:31-37`, `626-676`).
4. P3 (áudio só de pista de áudio), P4 (vence o primeiro clipe), P5 (`disabled` = bypass, nunca mudo) (`modelo.py:21-30`); a categoria `audio_fx` liga `audio_eq`, `audio_dynamics`, `volume` (`modelo.py:63-68`).
5. Crossfade com `transitionId` = dois clipes tocando juntos, cada um com a sua cadeia (`player.js:5043-5071`, `grafo_audio.py:682-744`).
6. Saída 48 kHz, `fltp`, estéreo, `amix normalize=0`, `alimiter` −0,2 dBTP (`grafo_audio.py:93-103`, `825`, `882-885`).
7. **O som nunca morre por culpa da cadeia** (`player.js:5168-5171`). No render: página falhou ⇒ reserva FFmpeg com aviso; nunca arquivo mudo, nunca job derrubado pela página.
8. Preflight barato (sem ffprobe, sem lançar navegador); nada baixa sozinho; um `Navegador` por job e por thread (D1 §2.2 e §4.6).
9. Cenário canônico multipista em cascata verde em toda etapa que toque `grafo_audio.py`, `comando.py`, `execucao.py` ou `player.js`.
10. `grafo_audio.py:3` e `:72` citam `player.js:2623` e `2537-2555`, defasadas: a cadeia está em `player.js:5254-5398`. O módulo novo vira a fonte única e a docstring passa a apontar para ele.

## 3. O que o HyperFrames tem
### 3.1 Peças e veredito [lido]

| Peça | Onde | Veredito |
|---|---|---|
| Princípio "um construtor de grafo, dois consumidores" (preview e render) | `HF:packages/core/src/runtime/audioFx.ts:1-12`; `HF:packages/engine/src/services/audioFxRender.ts:1-13` | **Adaptar** o princípio. No HF o preview toca `AudioBuffer`; no Talho o player captura o `<audio>` (`createMediaElementSource`) |
| `planAudioFxSegments`, `RENDER_QUANTUM = 128`, limites (300 s, pré 10 s, pós 1 s, teto 300 s, acima de 512 MiB) | `audioFxRender.ts:349-390` | **Adaptar**: portar para Python (≈ 20 linhas, cabeçalho Apache-2.0 e crédito) com parâmetros do Talho (4.3) |
| Memória da cadeia = release × ln(1000), soma em série | `HF:audioFxWarmup.ts:12-58` | **Inspirar-se**: no Talho é constante (gate 0,55 s, compressor 1,7 s) |
| Render com `latency`: `total = frames + tail + latency`, descarta o começo | `HF:packages/core/stubs/audio-fx-runtime-entry.ts:98-130`; `HF:packages/core/src/audio/audioFxTail.ts:128` | **Adaptar**: 288 quadros do compressor a 48 kHz [medido] |
| Janela com página nova; cauda só na última | `audioFxRender.ts:429-490` | **Inspirar-se**: o Talho reaproveita a página e a recria a cada 1 800 s processados |
| Dados por `page.evaluate` em base64 (8 MiB) | `audioFxRender.ts:657-757` | **Não adotar** [medido]: 15 MB/s (ida), 27 MB/s (volta) contra 157–329 MB/s por HTTP local |
| Página `file://` para obter contexto seguro | `audioFxRender.ts:625-648` | **Não adotar**: a D1 serve em `127.0.0.1` |
| Worklets por `data:text/javascript;base64` | `HF:packages/core/src/audio/audioFxWorklets.ts:373-390` | **Inspirar-se**: útil em teste; produção usa a URL do servidor |
| **Envelope de volume aplicado DEPOIS da cadeia** | `audioFxRender.ts:481`, `589` | **Não adotar**: contraria a regra 2 do E2 do Talho (o fade entra no gate e no compressor) |
| Compressor/limiter/gate próprios em AudioWorklet (sem `DynamicsCompressorNode`) | `HF:packages/core/src/audio/audioFxGraph.ts:257` (grep sem ocorrência do nó nativo) | **Não adotar**: o player do Talho usa o nó nativo, então a paridade é com ele |
| Leitor/escritor WAV (`riffChunks`, `resolveDataBytes`: tamanho 0 ou 0xFFFFFFFF = até o fim) | `audioFxRender.ts:100-135`, `HF:wavChunks.ts` | **Inspirar-se**: `wav_f32.py` (novo), ≈ 40 linhas |

### 3.2 Erros e omissões em `docs/PESQUISA_HYPERFRAMES.md` (§1 linha 1, §4.1)

1. **§4.1 passo 4** (servir o WAV pela rota interna e receber por `POST` interceptado): inviável. A origem `titulos.capiau` é insegura; mesmo em origens seguras com `page.route` o `addModule` do gate falha (`AbortError`), porque a carga do módulo não passa pela rota [medido, 4.4]; e o `POST` por rota fez 7 MB/s [medido].
2. **§4.1 passo 3** ("só o trecho hpf…makeup de clipes com EQ ou dinâmica passa pela página"): refinado. Com o Q corrigido o EQ do FFmpeg fica a −93,6 dBFS RMS do navegador [medido]; vão à página só os clipes com gate ou compressor ativos.
3. **§1 e §4.1** (as duas divergências são "2,06 dB" e "gate por bloco"): incompleto e subestimado. Faltam EQ, mono e latência, e o compressor diverge de 0,6 a 19 dB conforme o nível [medido].
4. **§4.1** ("janelas alinhadas ao quantum tornam o gate por bloco reproduzível"): vale para janelas × render inteiro (0 amostras diferentes em 57,6 M [medido]). Não vale para o ao vivo, cuja grade de 128 depende de quando o contexto começou: ao vivo = offline bit a bit só com início múltiplo de 128 [medido].
5. **§4.1 passo 5** ("remover os dois textos"): a reserva FFmpeg continua existindo; os textos devem ser **reescritos** com os números reais, não só removidos.
6. **§4.1 risco** ("desempenho [a medir]"): medido, 72–81× tempo real; mas 1 h numa janela só leva o navegador a 3,35 GB de RAM, então janelas são obrigatórias (4.6).
7. O HF aplica o envelope **depois** da cadeia; copiar isso quebraria o E2 (3.1).

## 4. Verificações de viabilidade
| # | Pergunta | Veredito |
|---|---|---|
| 1 | Ciclo de vida da cadeia no player | Por elemento (por pista), estado contínuo entre clipes. O render usa cadeia fria por clipe (erro medido) e, opcional, aquecimento em corte de navalha |
| 2 | Onde entram fade e volume | Já corretos no FFmpeg, antes da cadeia. O pré-passe entrega f32, 48 kHz, estéreo, já multiplicado |
| 3 | Janelas do HF em Python | **Viável**: 120 s, pré 8 s, pós 1 s, grade de 128, latência 288. Bit-exato [medido] |
| 4 | Gate em AudioWorklet offline em `127.0.0.1` | **Viável**, mas só com servidor real (ou `blob:`/`data:`); `page.route` não serve |
| 5 | Determinismo e ao vivo = offline | **Viável**: determinístico; ao vivo = offline bit a bit depois de ~200 ms. Edge × Chrome [a medir] |
| 6 | Desempenho de 1 h | **Viável com ressalva**: 72× tempo real; janelas obrigatórias; `PUT` só com `Blob` |
| 7 | Taxas e canais | 48 kHz fixo; mono duplicado (idêntico ao mono [medido]); mais de 2 canais reduzidos com aviso |
| 8 | Página × FFmpeg | Só `hpf … makeup` dos clipes com gate/compressor vai à página (tabela 4.8) |
| 9 | Reserva FFmpeg | Sim, com avisos refeitos e queda por clipe |

### 4.1 Pergunta 1: ciclo de vida da cadeia

- **Um grafo por elemento `<audio>`**, criado no primeiro `aplicarAudioAoVivo(el, efeitos)` com efeito ativo e guardado no `WeakMap` (`player.js:5282-5315`). `liberarAudioAoVivo` só desconecta e liga fonte → destino (5442-5454); os nós ficam.
- A cada sincronização os parâmetros do clipe atual entram em `_religarGrafo`; com a mesma topologia só `_aplicarParams` roda (5370-5373). **Os nós e o estado interno (compressor, gate, biquads) atravessam a troca de clipe** no mesmo elemento. Trocar de arquivo recarrega o elemento (4912-4916), não o grafo.
- Corte contíguo do mesmo arquivo não busca (`isContiguous`, `BUFFER_CONTINUITY_TOLERANCE = 0.1`, `player.js:2530`, `4950`): estado 100% contínuo.
- **Crossfade**: A em `audioPool[pista]`, B em `audioTransitionPool[pista]` (5064-5068), duas cadeias independentes; no fim B é promovido a principal e o estado dele continua (5074-5092). A "reserva" (5101-5119, `_parReservaAudio` em 5622) serve à troca tratado × original (F4), não ao próximo clipe: só nesses casos o estado nasce frio.
- Paridade "por clipe" exata não existe. O render usa **cadeia fria no início de cada clipe**. Perda medida num corte em trecho alto (sinal −13,5 dBFS RMS; hpf 80, gate −45, compressor −18 dB 2:1), diferença em relação a uma cadeia contínua (pico / RMS, dBFS):

| Início do clipe | 0–0,1 s | 0,1–0,5 s | 0,5–2 s |
|---|---|---|---|
| fria | −9,4 / −20,1 | −16,5 / −37,0 | −144 / −174 |
| aquecida com 1 s da própria fonte, grade de 128 igual | 0 | 0 | 0 (bit-exato) |
| idem, grade deslocada 37 quadros | −65,9 / −82,1 | −55,9 / −81,5 | −27,5 / −62,6 |

Leitura [medido]: nos primeiros 100 ms a diferença fica ≈ 7 dB abaixo do sinal na RMS (causa provável: compressor e gate sem estado [inferência]) e some em 0,5 s. Com pré-rolagem da própria fonte e a grade de 128 ancorada na fonte, o corte de navalha fica **bit-exato**; com grade deslocada sobra só a decisão do gate por bloco (RMS −60 a −66 dBFS, inaudível). **Decisão**: base com cadeia fria (Etapas 2–5); aquecimento só em corte contíguo da mesma fonte, mesma velocidade e mesmos parâmetros, na Etapa 6 opcional. Pré-rolagem em salto de corte (fonte diferente ou descontínua) seria pior: faria som que o editor cortou influenciar o compressor.

### 4.2 Pergunta 2: fade e volume

- Player: `el.volume = clamp(pista × clipe × fade × ganhoDaTransição, 0, 1)` (`player.js:5006-5008`). O fade é o **menor** dos fades de borda sem `transitionId`, `d = max(0.05, duration_s || 0.5)`, `evaluateFadeCurve(p, curve || "linear", tension || 0)` (4985-5003); na transição, `evaluateFadeCurve(1 − p, curve || "equal_power", tension || 0)` em A e `p` em B (5061-5062).
- Render: `_estagio_volume` (`grafo_audio.py:328-386`) gera `volume=volume='clip(produto*(expr),0,1)':eval=frame` com as curvas de `fade.py` e `_expressoes_transicao` (310-325). **Fica como está**.
- O pré-passe entrega à página: WAV `pcm_f32le`, 48 000 Hz, 2 canais, no tempo da timeline (retime aplicado), do trecho já estendido pela transição (`_estender`, 747-765), sem clamp em ±1 (o `alimiter` final trata picos).
- Não vão à página: mute/oculta de pista, `adelay`, `apad`, `amix`, `alimiter`, AAC.
- Ressalva preexistente, fora do escopo: no player o volume muda em degraus por sincronização, no FFmpeg por quadro de áudio [inferência; não medido].

### 4.3 Pergunta 3: janelas do HF e o equivalente em Python

| Parâmetro | HF (`audioFxRender.ts`) | Talho (proposta) |
|---|---|---|
| Quantum | 128; `readFrom` alinhado para baixo (`:366-390`) | 128, igual |
| Janela | 300 s, só acima de 512 MiB (`:349-355`) | 120 s; janela única se o clipe tem ≤ 150 s |
| Pré-rolagem | piso 10 s, teto 300 s, memória da cadeia (`audioFxWarmup.ts:46-58`) | 8 s (gate 0,55 s e compressor 1,7 s de memória; 5 s já deu bit-exato) |
| Pós-rolagem | 1 s | 1 s (≥ 288 quadros de latência) |
| Cauda | `chainTailSeconds` (reverb/delay) | 0 além da latência: o fim do clipe é silêncio |
| Latência | descarta o começo do render (`audio-fx-runtime-entry.ts:98-130`) | renderiza N + 288 e descarta 288 (compressor, 48 kHz) |
| Taxa e canais | os do arquivo | 48 000 Hz, 2 canais |
| Página | nova por janela (`:460`) | uma página, recriada a cada 1 800 s processados ou após erro |

[medido] 600 s estéreo, 5 janelas de 120 s (+5 s antes, +1 s depois, início múltiplo de 128) × render inteiro: **0 amostras diferentes em 57 600 000**, costuras com pico 0; 12,6 s contra 12,1 s; página nova 89–138 ms. A latência: 288 quadros a 48 kHz e 264 a 44,1 kHz (6 ms), com ou sem razão 1 [medido]; o nó tem `tailTime` de 5 × 0,325 s [web: https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/audio/DynamicsCompressorKernel.cpp], que não importa aqui. O detector do compressor é ligado entre canais (máximo absoluto de todos, um ganho só) [web: idem].

Equivalente puro (novo, testável sem navegador): `planejar_janelas(total, taxa=48000, *, janela_s=120, pre_s=8, pos_s=1, quantum=128) -> list[Janela]`, com `Janela(manter_de, manter_ate, ler_de, ler_ate, ultima)`.

Uso da interface da D1 (7.1), uma janela:

```python
url = nav.servidor.publicar_arquivo("wav", wav_pre)        # GET com Range
saida = nav.servidor.reservar_saida(f"{clipe}_{k}.f32")    # PUT de Blob direto para disco
pg = nav.pagina(64, 64)                                    # reaproveitada entre janelas
pg.abrir("ui/render_audio.html", pronto="window.RENDER_AUDIO_PRONTO === true")
pg.avaliar("([u, s, p]) => window.RENDER_AUDIO.processar(u, s, p)", [url, saida.url, params])
# o Python lê saida.caminho: sem pré/pós-rolagem e sem os 288 quadros de latência
```

Pedidos à D1: `PUT` com `Content-Length` e corpo de 100+ MB gravado em streaming; o teste M10 usar `Blob`; `Pagina.avaliar` aceitar função assíncrona (Promise).

### 4.4 Pergunta 4: o gate em AudioWorklet num `OfflineAudioContext`

**Viável, com servidor real.** [medido: exp1 e exp2]

| Origem da página | `isSecureContext` | `OfflineAudioContext.audioWorklet` | `addModule` do gate |
|---|---|---|---|
| `http://titulos.capiau` (hoje, `titulos.py`) | falso | indefinido | impossível |
| `render.localhost`, `audio.capiau.localhost`, `https://render.capiau`, `http://127.0.0.1` servidos por `page.route` | verdadeiro | sim | **falha** (`AbortError: Unable to load a worklet's module`) |
| `http://127.0.0.1:<porta>` com servidor HTTP real | verdadeiro | sim | **ok** |
| `blob:` e `data:` (em origem segura) | — | — | ok |

A carga do módulo do worklet não passa por `page.route` [inferência da causa; o sintoma é medido]. O servidor da D1 resolve; o módulo é pedido como `js/audioGateWorklet.js`, relativo a `ui/render_audio.html`, o mesmo layout de `render_titulos.html`.

### 4.5 Pergunta 5: determinismo, ao vivo × offline, navegadores

- **Determinismo** [medido]: 4 cadeias (EQ, gate, compressor, completa), 2 execuções no Chromium completo e 1 no `headless_shell` (ambos 141.0.7390.37): SHA-256 idênticos. Nada indica não determinismo; sem relógio nem aleatoriedade no grafo.
- **Ao vivo × offline** [medido: exp5e; `AudioContext` real do Chromium, 6 s estéreo 48 kHz, início em quadro múltiplo de 128, mesmo código de montagem do player]:

| Cadeia | Amostras diferentes (de 288 000) | Onde | Pico / RMS da diferença |
|---|---|---|---|
| EQ | 0 | — | — |
| Compressor | 2 986 | só os primeiros ~62 ms | −67,9 / −107,5 dBFS |
| Gate | 3 436 | só os primeiros ~72 ms | −44,6 / −84,4 dBFS |
| Completa | 4 550 | só os primeiros ~200 ms | −35,2 / −76,1 dBFS |

Depois disso, **bit a bit iguais** (sinal em −18 a −22 dBFS RMS). Causa do transitório inicial: estado dos nós no contexto ao vivo [inferência]; irrelevante no render, que é sempre offline. Com início fora da grade de 128 só há igualdade estatística (4.1).
- **Edge × Chrome** [a medir]: mesmo Blink, mas o Edge do Fernando é de outra versão. `scripts/medir_paridade_audio.py` (novo) roda a cadeia canônica nos canais `msedge`, `chrome` e `headless_shell` e imprime SHA-256. Critério: iguais; se diferirem, RMS da diferença ≤ −100 dBFS e a versão entra em `assinatura()` (D1 D9).
- **Null tests do CI** (`tests/test_audio_cadeia_paridade.py` (novo), `skipif` sem navegador): offline × offline idêntico; janelas × inteiro com 0 amostras diferentes; ao vivo × offline com 0 diferenças depois de 250 ms; EQ do FFmpeg corrigido × página ≤ −70 dB re. o sinal (medido −77); latência compensada (impulso volta à posição 0).

### 4.6 Pergunta 6: desempenho e memória

[medido: exp7, exp8, exp10, exp11, exp17; vCPU 2,1 GHz; o i7-10700 deve ser mais rápido [inferência]]

| Cadeia (estéreo 48 kHz) | Tempo | × tempo real |
|---|---|---|
| EQ, 600 s | 3,6 s | 168 |
| gate (worklet), 600 s | 2,7 s | 224 |
| compressor, 600 s | 2,5 s | 235 |
| completa, 600 s | 7,4 s | 81 |
| completa, **3 600 s numa janela só** | 49,9 s | 72 |

Memória: pico somado dos processos do Chromium 1,58 GB (600 s) e **3,35 GB (3 600 s)** numa janela só; o construtor aceita 120 min estéreo, mas `Float32Array` ≥ 2 GiB falha. Janelas de 120 s mantêm três cópias de ≈ 49 MB (≈ 0,4–0,5 GB no total [a medir]). Disco: 384 KB/s por clipe processado (f32 estéreo): 1 h ≈ 1,4 GB.

| Caminho de dados (128 MiB) | MB/s |
|---|---|
| `page.evaluate` base64, Python → página (8 MiB) | 15 |
| `page.evaluate` base64, página → Python | 27 |
| `page.route` com `POST` | 7 |
| HTTP local `GET` com Range de 8 MiB / um pedido (servidor Python) | 157 / 329 |
| HTTP local `PUT` com `Uint8Array` | **13–19** |
| HTTP local `PUT` com `Blob` (8 MiB × 16 / um pedido) | **310 / 203** |
| `setInputFiles` + leitura em fatias / download de `Blob` | 651 / 210 |

Armadilha: `fetch(..., { method: "PUT", body: new Uint8Array(...) })` é 15× mais lento que com `Blob`. A página sempre envia `Blob`. Com a interface da D1 (`publicar_arquivo` para a entrada, com Range; `reservar_saida` para a saída) o transporte não é gargalo.

### 4.7 Pergunta 7: taxas, canais, reamostragem

- Player: `AudioContext` sem `sampleRate` (`player.js:5212`), logo a taxa do dispositivo (48 kHz no contêiner; 44,1 kHz é possível no Windows [inferência]). Render: `SAMPLE_RATE_SAIDA = 48000` (`grafo_audio.py:94`, `aresample` em `883`).
- A cadeia é definida em segundos e Hz (ataque, release, frequências), então a taxa só muda detalhes: latência 264 contra 288 quadros (6 ms nos dois), bloco do gate 2,9 contra 2,7 ms, empenamento dos biquads perto de Nyquist [inferência]. **A página roda sempre a 48 000 Hz**; o pré-passe faz `aresample=48000`.
- A reamostragem do `<audio>` (Chromium) e a do `swresample` não foram comparadas [a medir; ambas de alta qualidade].
- **Canais**: o elemento mono entra no grafo com 1 canal e o destino faz L = R sem perda [medido: 0,5 → 0,5 e 0,5]. O grafo FFmpeg de hoje faz mono → estéreo por `aformat=channel_layouts=stereo`, que dá **−3,01 dB** [medido; `pan` com c0 nos dois lados dá 0 dB]. O pré-passe duplica mono em estéreo com ganho 1; mono 1 canal × estéreo duplicado pela cadeia completa: **0 amostras diferentes** [medido]. Fonte com mais de 2 canais: o player manda todos ao grafo (detector ligado entre canais) e o destino reduz; no pré-passe reduz-se a estéreo antes da cadeia, com aviso (`AUDIO_MULTICANAL_REDUZIDO` (novo)) [a medir a diferença]. Mistura de mono e estéreo no mesmo `amix` [a medir].

### 4.8 Pergunta 8: o que vai para a página e o que fica no FFmpeg

| Etapa | Onde | Observação |
|---|---|---|
| Resolver mídia (original, proxy, WAV tratado) e `-ss/-t` | FFmpeg (`_entrada_do_recorte`, `626-676`) | igual |
| `atrim`, `asetpts`, retime (`atempo`, `areverse`, `asetrate`) | FFmpeg, pré-passe | igual ao player (o elemento retemporiza antes do grafo) |
| volume da pista × clipe × fade × transição | FFmpeg, pré-passe | regra 2 do E2 |
| `aresample 48000`, mono → estéreo, f32 | FFmpeg, pré-passe | |
| **hpf → low → mid → high → gate → compressor → makeup** | **página** (`audioCadeia.js`) | só se há gate ou compressor ativo |
| EQ sozinho, makeup sozinho | FFmpeg (EQ com Q corrigido) | −93,6 dBFS RMS contra a página [medido] |
| `adelay`, `apad`, `amix`, volume final, `alimiter`, AAC | FFmpeg, grafo final | o WAV da página entra como `-i` |
| Mute, oculta, escopo, regra P4 | Python puro (`grafo_audio.py`) | igual |

### 4.9 Pergunta 9: navegador indisponível

**Manter o FFmpeg atual como reserva**, com a Etapa 0 e com os avisos refeitos com os números de 1 e 4.10.

| Situação | Ação | Aviso |
|---|---|---|
| `render.audio_cadeia = ffmpeg` | cadeia FFmpeg | `info`; divergências na tabela real |
| `auto` e `diagnostico_barato()` sem navegador | cadeia FFmpeg | `warn` com os números medidos (substitui os dois textos) |
| Navegador sobe, a página falha num clipe (worklet não carrega, tempo esgotado, queda) | só esse clipe usa FFmpeg | `warn AUDIO_CADEIA_FALLBACK` com clipes e causa |
| Disco sem espaço para os WAV intermediários | cadeia FFmpeg | `warn` com a conta |
| Cancelado | para, apaga temporários | — |

### 4.10 Números do FFmpeg atual contra o navegador (base da Etapa 0 e dos avisos refeitos)

[medido: exp4, exp13, exp14b, exp15, exp18, exp19; sinais sintéticos]. Compressor, senoide de 1 kHz em regime: ganho do `acompressor` do grafo atual (`knee=8`) menos o ganho do `DynamicsCompressorNode` com o mesmo limiar e razão, em dB:

| Limiar, razão | −30 dBFS | −18 dBFS | −12 dBFS | −6 dBFS | 0 dBFS | Chromium abaixo do limiar |
|---|---|---|---|---|---|---|
| −18 dB, 4:1 | −1,1 | −2,7 | −5,5 | −9,2 | −12,6 | +1,1 dB |
| −24 dB, 3:1 | −2,1 | −5,9 | −9,3 | −12,4 | −14,6 | +2,0 dB |
| −18 dB, 2:1 | −0,6 | −1,7 | −3,6 | −6,1 | −8,5 | +0,6 dB |
| −30 dB, 4:1 | −6,2 | −12,7 | −16,1 | −18,5 | −19,4 | +4,6 dB |

O nó nativo tem joelho de 30 dB e **ganho de compensação automático** (`fullRangeMakeupGain = (1/saturate(1))^0.6` [web: https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/audio/DynamicsCompressorKernel.cpp]). Com limiar −18 e 4:1 ele vai de +1,1 dB (até −21 dBFS) a −0,7 dB (0 dBFS), um compressor bem suave; o `acompressor` vai de 0 a −13,3 dB.
- **EQ**: erro máximo entre 20 Hz e 20 kHz de 1,00 dB no HPF e de 1,14 dB (±6) e 1,97 dB (±12) nos shelves; mid (`equalizer`) 0,00. O Q do `highpass` do WebAudio é em dB (1 dB = 1,122 linear). Com `width` 1,122018 e 0,5 o erro cai a 0,0000 dB e, no tempo, de pico −21,8 / RMS −40,7 dBFS para −76,2 / −93,6 dBFS.
- **Gate**: o RMS total é igual, mas a diferença tem pico −16,5 e RMS −61,2 dBFS (−42 dB re. o sinal) nas transições; em pausa o worklet decai a ≈ −73 dBFS e o `agate range=0` vai a −∞.
- **Mono** e **latência**: 4.7 e 4.3.

## 5. Decisões de projeto
| # | Decisão | Alternativas (prós e contras) | Recomendação |
|---|---|---|---|
| DA1 | Onde roda a cadeia | (a) Página por clipe, com pré-passe FFmpeg e WAV f32 intermediário: paridade por construção; custa ≈ 384 KB/s de disco e uma etapa antes do vídeo. (b) Melhorar a reserva FFmpeg (`compand` com a curva estática do Chromium, Q, `pan`): sem navegador, mas nunca igual (release adaptativo, pré-atraso, detector entre canais) e dois códigos a manter. (c) Página processa a pista e já mixa: reimplementa corte, retime e crossfade fora do FFmpeg e quebra o E2 | **(a)**; (b) só como melhoria da reserva, fora deste plano |
| DA2 | Quem vai à página | (P) todo clipe com EQ ou dinâmica ativos; (Q) só com gate ou compressor ativos (EQ-only no FFmpeg com Q corrigido) | **(Q)**: renders só com EQ não sobem navegador; −93,6 dBFS RMS [medido]; teste de deriva página × FFmpeg ≤ −70 dB re. o sinal; se falhar, uma constante passa para (P) |
| DA3 | Onde mora o construtor | (a) `audioCadeia.js` sem DOM, usado pelo player e pela página. (b) copiar o código na página (deriva certa; foi o que os experimentos fizeram em `cadeia_copia.js`, só para medir). (c) a página importa `player.js` (arrasta DOM, `STATE`, API) | **(a)** |
| DA4 | Transporte | (a) servidor da D1: `GET` Range na entrada, `PUT` de `Blob` na saída (157–329 e 203–310 MB/s). (b) base64 por `evaluate` (HF): 15–27 MB/s. (c) `setInputFiles` + download: 651 e 210 MB/s, mas fora da interface da D1 | **(a)**, como a D1 manda; (c) vira plano B se o `PUT` ficar < 100 MB/s no Windows |
| DA5 | Formato intermediário | f32 (4 bytes), s24 (−25% de disco, ruído a −144 dBFS, perde o bit-exato do null test), s16 (quantiza antes do compressor) | **f32**, 48 kHz, 2 canais |
| DA6 | Janelas | 120 s + pré 8 s (4.3); 300 s do HF (mais memória); clipe inteiro (3,35 GB por hora) | **120 s** |
| DA7 | Latência de 6 ms do compressor | compensar (renderiza N + 288 e descarta 288) ou manter o atraso da tela | **compensar**: o atraso é artefato do nó e o arquivo fica alinhado ao vídeo |
| DA8 | Estado entre clipes | (N0) cadeia fria por clipe; (N1) aquecida em corte de navalha: pré-rolagem da própria fonte + grade de 128 ancorada na fonte; (N2) uma cadeia contínua por pista (rejeitada: parâmetros e topologia mudam por clipe, lacunas e recargas do player não se reproduzem) | **N0** na base; **N1** na Etapa 6, se o Fernando ouvir a diferença |
| DA9 | Liberação gradual | constante `AUDIO_NAVEGADOR_PARIDADE_MEDIDA = False` + `render.audio_cadeia` (novo) (`auto`, `navegador`, `ffmpeg`) | `auto` só usa a página com a constante `True`; `navegador` força, para teste; virar `True` na Etapa 5 |
| DA10 | Cache do WAV de cadeia | nenhum (tmpdir do job); ou por hash em `data/cache/audio_cadeia/` com teto | nenhum na base; hash na Etapa 6 (fonte + mtime + tamanho, in/out/velocidade/reverso/tom, estágio de volume, parâmetros, `assinatura()`, `CADEIA_AUDIO_VERSAO`) |
| DA11 | Texto do banner | apagar os dois, ou reescrever | **reescrever** com os números de 1 e 4.10, em ponto único, só para a reserva |

## 6. Modelo de dados e compatibilidade

**Configuração** (`settings_registry.py`, após `render.threads`, ~linha 598; categoria `timeline`, nível `pro`, escopo `global`, `requires_reprocess: False`):

| Chave | Tipo e padrão | Efeito |
|---|---|---|
| `render.audio_cadeia` | enum `auto`, `navegador`, `ffmpeg`; padrão `auto` | `auto` = página quando há navegador **e** `AUDIO_NAVEGADOR_PARIDADE_MEDIDA` (novo); `navegador` força (falha vira reserva + aviso); `ffmpeg` nunca usa a página |

**Disco.** Temporário do job: `<parcial>_audio/` com `pre_<clipe>.wav`, `cad_<clipe>.wav` e `jan_<k>.f32`, apagado no `finally` (`execucao.py:597-603`). Cache opcional (Etapa 6): `data/cache/audio_cadeia/<hash>.wav`, com teto em GB. Formato: WAV `WAVE_FORMAT_IEEE_FLOAT`, 32 bits, 48 000 Hz, 2 canais; `wav_f32.py` aceita `LIST` e tamanho 0 ou 0xFFFFFFFF (como `HF:audioFxRender.ts:100-135`).

**Compatibilidade.**
- `grafo_audio_completo(..., resolver_cadeia=None)` e `cadeia_clipe_audio(..., cadeia_pronta=False)`: com os padrões a string do filtro é **idêntica** à de hoje (teste com string congelada nos cenários de `tests/test_render_grafo_audio_transicao.py` e no canônico). `montar_comando(..., cadeias_audio=None)` e `fidelidade.relatorio(..., audio_navegador=None)` idem.
- Player: `aplicarAudioAoVivo`, `liberarAudioAoVivo`, `audioAoVivoDisponivel`, `gateAoVivoDisponivel` e os privados citados mantêm nome e efeito; só o corpo delega ao módulo. `audioGateWorklet.js` não muda.
- Sem mudança em `sequence_json`, banco, blocos `audio_eq`/`audio_dynamics`/`volume`, WAV tratado. Nenhuma dependência pip nova (`wave`, `struct`, `hashlib`, `subprocess`).
- `CADEIA_AUDIO_VERSAO = 1` em `audioCadeia.js`, espelhada em Python com teste de deriva (também para `HPF_MAX_HZ`, `EQ_GAIN_*`, `GATE_DB_*`, `COMP_*`, `MAKEUP_*` e os padrões de `grafo_audio.py:75-91`). Muda quando topologia, nós ou constantes mudam; entra em `assinatura()` e no cache.
- Avisos novos: `AUDIO_CADEIA_NAVEGADOR` (novo) (info), `AUDIO_CADEIA_SEM_NAVEGADOR` (novo), `AUDIO_CADEIA_FALLBACK` (novo), `AUDIO_MULTICANAL_REDUZIDO`, `AUDIO_ESPACO_TEMPORARIO` (novo). Os dois antigos ficam só na reserva, com texto novo.
- Créditos: o planejador de janelas leva o cabeçalho "Adaptado de HyperFrames, Copyright 2026 HeyGen, Inc., Apache-2.0; portado de TypeScript para Python" e entra na seção de créditos.

## 7. Mudanças por arquivo
| Arquivo | Novo/alterado | O que muda |
|---|---|---|
| `src/ui/js/audioCadeia.js` | novo | Sem DOM: `CADEIA_AUDIO_VERSAO`, `LIMITES`, `normalizarEfeitosAudio`, `topologiaCadeia`, `precisaGate`, `criarNosCadeia(ctx)`, `criarGate(ctx)`, `aplicarParametros`, `ligarCadeia(nos, gate, fonte, destino, topologia)`, `carregarGate(ctx, url)`. Corpo = trechos movidos de `player.js:5254-5398` |
| `src/ui/js/player.js` | alterado (bloco C1, 5178-5455) | `_efeitosAudioAoVivo`, `_topologiaAudioAoVivo`, criação dos nós em `_obterGrafo`, `_aplicarParams`, `_religarGrafo` e `_carregarGateAoVivo` delegam; nomes, ordem das conexões e efeitos colaterais iguais. Commit só desses trechos |
| `src/ui/js/audioGateWorklet.js` | intacto | |
| `src/ui/render_audio.html`, `src/ui/js/renderAudio.js` | novo | `window.RENDER_AUDIO.processar({urlEntrada, dados, urlSaida, efeitos, manter})`: lê Range do WAV, `OfflineAudioContext(2, n + 288, 48000)`, carrega o gate, renderiza, descarta a latência, envia o trecho mantido em `PUT` de `Blob`; `window.RENDER_AUDIO_PRONTO = true` |
| `scripts/tema_tokenizar.mjs` | alterado (linha 20) | se a lista que contém `audioGateWorklet.js` for de arquivos sem cor, incluir os dois JS novos [a conferir] |
| `src/export/video_render/cadeia_audio.py` | novo | Puras: `precisa_cadeia` (novo), `planejar_janelas`, `comando_prepasse` (novo). Com efeitos: `montar_cadeias(seq, escopo, rel_midia, navegador, ...)`, `processar_wav(...)`; reserva por clipe, progresso, cancelamento, temporários |
| `src/export/video_render/wav_f32.py` | novo | Ler/escrever cabeçalho WAV f32; juntar janelas |
| `grafo_audio.py` | alterado | `_filtros_eq` (HPF `width=1.122018`, shelves `width=0.5`); `cadeia_clipe_audio` dividida em pré e pós (`cadeia_pronta`); `camada_pista_audio` expõe `ramos_da_pista`; `resolver_cadeia`; mono → estéreo sem perda; docstring E2 aponta o módulo novo |
| `comando.py` | alterado | `montar_comando(..., cadeias_audio=None)`; tipo de entrada `audio_cadeia` com caminho pronto (linha 423); `_chamar_grafo_audio` repassa |
| `execucao.py` | alterado | estágio "Áudio" entre Destino e Comandos; `Navegador` do job (o da D1 Etapa 3 ou próprio); `_limpar` da pasta; progresso e `cancelado()` |
| `fidelidade.py` | alterado | `relatorio(..., audio_navegador)`; textos com números; `AUDIO_NAVEGADOR_PARIDADE_MEDIDA`; códigos novos |
| `settings_registry.py` | alterado | `render.audio_cadeia` |
| `tests/test_render_audio_eq_mono.py`, `test_render_audio_cadeia.py`, `test_audio_cadeia_paridade.py`, `test_render_audio_cadeia_cascata.py`, `tests/autoteste_audio_cadeia.mjs` (novo) | novos | Seção 9 |
| `scripts/medir_paridade_audio.py` | novo | Roda no Windows; `msedge`, `chrome`, `headless_shell`; SHA-256, null tests, FFmpeg × página |
| `docs/plano_hyperframes/A_audio_paridade.md` (novo), `docs/MEDICOES_AUDIO.md` (novo), `docs/PESQUISA_HYPERFRAMES.md` (§1, §4.1) | novo, novo, alterado | plano, números, correções de 3.2 |

## 8. Etapas
Mensagens em conventional commits, em português. Em toda etapa que toca `grafo_audio.py`, `comando.py`, `execucao.py` ou `player.js`: rodar `pytest tests/test_render_composicao_multipista_cascata.py`, `node tests/autoteste_composicao_multipista_cascata.mjs` e `pytest tests/test_render_*.py`.

**Etapa 0. Correções do FFmpeg que não dependem do navegador.**
- Commit: `fix(render): Q do HPF e dos shelves do EQ e mono sem perda de 3 dB no grafo de áudio`.
- Entra: `_filtros_eq` com HPF `width_type=q:width=1.122018` (= 10^(1/20): o Q do `highpass` do WebAudio é em dB) e shelves `width=0.5` (zera o erro no FFmpeg 6.1.1; **reconferir no FFmpeg do Windows** pelo teste); mono → estéreo com ganho 1 (`pan` só em fonte mono, canais por `ffprobe` dentro do job, nunca no preflight); `TEXTO_JOELHO_COMPRESSOR` e `TEXTO_DETECTOR_GATE` reescritos com os números de 1 e 4.10; docstring sem as linhas defasadas.
- Testes (`tests/test_render_audio_eq_mono.py`): resposta ao impulso do filtro gerado (`ffmpeg` real, `skipif` sem ele) contra a resposta medida no Chromium (fixture congelada, 16 curvas × 100 pontos): máx |dif| ≤ 0,01 dB para hpf 60/80/120/200 e shelves ±6/±12; mono 0,5 constante sai 0,5 em L e R; estéreo inalterado; `amix` com mono e estéreo [a medir]; strings dos testes existentes só mudam onde o Q muda.
- Dias: 1,0. Depende de: nada.

**Etapa 1. Módulo compartilhado `audioCadeia.js`; o player delega.**
- Commit: `refactor(player): cadeia de áudio ao vivo extraída para audioCadeia.js sem mudar o comportamento`.
- Entra: `audioCadeia.js`; bloco C1 do `player.js` delegando; `tests/autoteste_audio_cadeia.mjs`; `scripts/tema_tokenizar.mjs` se preciso.
- Testes (Node ESM, `ctx` falso que registra criação de nós e `connect/disconnect`): **cópia congelada das funções antigas** (de `9cba1b2`) como oráculo contra o módulo, em ≈ 300 combinações (bloco ausente, `disabled`, NaN, texto, fora da faixa, hpf 0, razão 1, gate −90, makeup ±12): mesmo `p`, mesma topologia, mesmos valores aplicados, mesma sequência de conexões; `player.js` importa o módulo; `_religarGrafo` com `g` falso liga igual; `autoteste_audio_crossfade.mjs`, `autoteste_player_f4.mjs` e o canônico sem alteração.
- Dias: 1,5. Depende de: nada (pode ir em paralelo com a D1).

**Etapa 2. Página de render de áudio e processamento de um WAV.**
- Commit: `feat(render): página e processador de áudio no navegador com a mesma cadeia do player e null tests`.
- Entra: `render_audio.html`, `renderAudio.js` (novo), núcleo de `cadeia_audio.py` (novo) (`planejar_janelas`, `processar_wav` (novo) sobre `Navegador`/`Pagina`, latência compensada, página recriada), `wav_f32.py`, esqueleto de `scripts/medir_paridade_audio.py`.
- Testes: puros (`planejar_janelas` cobre o total, início múltiplo de 128, bordas sem pré/pós, janela única até 150 s; `wav_f32` com `LIST`, tamanho 0 e 0xFFFFFFFF, recusa de formato); com navegador (`skipif not navegador_utilizavel()`): determinismo (2 execuções, mesmo SHA-256), janelas × inteiro (40 s, janela de 12 s: 0 diferenças), ao vivo × offline (0 depois de 250 ms), latência (impulso na posição 0), mono × estéreo duplicado (0), `PUT` de `Blob` ≥ 100 MB/s, página recriada após erro, `abortar()` no meio.
- Dias: 3,0. Depende de: D1 etapas 1 e 2; Etapa 1.

**Etapa 3. Pré-passe FFmpeg e integração no grafo e na execução (opt-in).**
- Commit: `feat(render): clipes com gate ou compressor passam pelo navegador (render.audio_cadeia=navegador)`.
- Entra: `precisa_cadeia`; `comando_prepasse` (reaproveita `atrim → retime → volume/fade` de `grafo_audio.py`, `aresample 48000`, mono → estéreo, `pcm_f32le`); `grafo_audio` dividido em pré e pós com `resolver_cadeia` e `ramos_da_pista`; `comando` (`cadeias_audio`, tipo `audio_cadeia`); estágio "Áudio" em `execucao` com progresso, cancelamento e limpeza; reserva por clipe (`AUDIO_CADEIA_FALLBACK`); faixa parcial do job com pré-rolagem tirada do começo do próprio clipe; `render.audio_cadeia` com `navegador` e `ffmpeg`.
- Testes: puros: com `resolver_cadeia=None` a string é idêntica à de hoje; com ele o ramo vira `atrim, asetpts, adelay, apad` (sem volume, EQ ou dinâmica); `ss/t` no tempo do WAV, não da fonte; transição A/B com duas cadeias; WAV tratado; clipe que cruza o limite de segmento lê o mesmo WAV; `precisa_cadeia` (EQ-only não, makeup-only não, gate ou compressor sim, `disabled`, escopo desligado). Composto (`tests/test_render_audio_cadeia_cascata.py`): cenário canônico + duas pistas de áudio (crossfade com compressor e gate; outro clipe só com EQ), mídia sintética por `lavfi`, saída PCM f32; áudio igual com e sem a camada de ajuste; página falhando (injetada) cai no FFmpeg só naquele clipe.
- Dias: 3,0. Depende de: Etapa 2.

**Etapa 4. Preflight, configuração e avisos.**
- Commit: `feat(render): preflight e avisos de fidelidade do áudio pelo navegador`.
- Entra: `relatorio(..., audio_navegador)` com `diagnostico_barato()` da D1; `AUDIO_NAVEGADOR_PARIDADE_MEDIDA = False`; textos novos da reserva; avisos novos; `auto` em `render.audio_cadeia`; rótulo em Configurações.
- Testes: a tabela 4.9 vira teste; preflight sem navegador não cria processo e leva < 100 ms; com a constante `False`, `auto` não usa a página; os textos citam os números medidos.
- Dias: 1,0. Depende de: Etapa 3.

**Etapa 5. Medida no Windows e liberação.**
- Commit: `feat(render): áudio pelo navegador liberado por padrão depois da medida de paridade`.
- Entra: rodada de `scripts/medir_paridade_audio.py` pelo Fernando (Edge e Chrome, ≈ 10 min); `docs/MEDICOES_AUDIO.md`; `AUDIO_NAVEGADOR_PARIDADE_MEDIDA = True` se os critérios da seção 10 passarem; os dois avisos somem quando a página é usada.
- Testes: os de aceite; os números medidos viram asserções em `tests/test_audio_cadeia_paridade.py`.
- Dias: 1,5. Depende de: Etapa 4 e da rodada do Fernando.

**Etapa 6 (opcional). Continuidade em corte de navalha e cache.**
- Commit: `feat(render): cadeia aquecida em cortes contíguos da mesma fonte e cache do WAV de cadeia`.
- Entra: `emendas_continuas` (novo) (puro: mesma fonte, `out ≈ in` a ≤ 1 quadro, velocidade 1, sem reverso, mesmos parâmetros, sem fade na emenda); grade de 128 ancorada no quadro 0 da fonte; pré-rolagem de 1 a 8 s da própria fonte; cache por hash com teto (`render.audio_cadeia_cache_gb`).
- Testes: invariância à navalha (A+B contíguos × clipe inteiro): 0 diferenças com a mesma grade; RMS ≤ −59 dBFS com grade deslocada; salto de corte (fonte diferente ou descontínua) continua frio; cache acerta e erra por parâmetro e por `assinatura()`.
- Dias: 2,0. Depende de: Etapa 5.

**Etapa 7. Documentação.**
- Commit: `docs(render): áudio pelo navegador, medições e correções da pesquisa do HyperFrames`.
- Entra: `docs/PESQUISA_HYPERFRAMES.md` (§1 linha 1 e §4.1, conforme 3.2), créditos, docstring E2 final.
- Dias: 0,5. Depende de: Etapa 5.

Total: 1 + 1,5 + 3 + 3 + 1 + 1,5 + 0,5 = **11,5 dias**; com a Etapa 6, **13,5** [inferência; estimativa grossa]. A D1 (etapas 1 e 2) soma ≈ 3 dias antes da Etapa 2.

## 9. Testes e medições
"Medido" = número do contêiner Linux (4.x); metas sem base medida estão marcadas.

| ID | O que | Número-alvo | Como medir |
|---|---|---|---|
| MA1 | Janelas × render inteiro (cadeia completa) | 0 amostras diferentes (medido: 0 de 57,6 M) | `test_audio_cadeia_paridade.py`, 40 s com janela de 12 s e, na rodada do Windows, 600 s com 120 s |
| MA2 | Determinismo | mesmo SHA-256 em 2 execuções e entre `headless_shell` e navegador completo (medido) | idem |
| MA3 | Ao vivo × offline | 0 amostras diferentes depois de 250 ms; antes, pico ≤ −35 dBFS (medido −35,2) | `AudioContext` real + worklet "tap" no teste (≈ 8 s) |
| MA4 | Edge × Chrome × shell | SHA-256 igual; senão RMS da diferença ≤ −100 dBFS [a medir] | `medir_paridade_audio.py` no Windows |
| MA5 | EQ do FFmpeg corrigido × página | resposta: máx \|dif\| ≤ 0,01 dB (medido 0,0000); tempo: RMS ≤ −90 dBFS e ≤ −70 dB re. o sinal (medido −93,6 e −77) | Etapa 0 e deriva no CI |
| MA6 | Latência do compressor compensada | impulso volta a 0 quadros (288 a 48 kHz) | teste com impulso |
| MA7 | Velocidade da cadeia completa | ≥ 50× tempo real; 1 h ≤ 90 s no i7-10700 (meta; medido 72× e 49,9 s no vCPU de 2,1 GHz) | `medir_paridade_audio.py --tempo` |
| MA8 | Memória do navegador | pico da árvore ≤ 1 GB com janelas de 120 s (meta; medido 3,35 GB numa janela de 1 h); +≤ 100 MB depois de 30 janelas | medição da D1 (M7) durante MA7 |
| MA9 | Transporte | entrada e saída ≥ 100 MB/s (medido 157–329 e 203–310); `PUT` com `Uint8Array` proibido | teste do código de `renderAudio.js` + vazão no `ServidorLocal` |
| MA10 | Custo do pré-passe FFmpeg por clipe | ≤ 0,3 s + 0,02 × duração (meta) | Etapa 3, 50 clipes sintéticos |
| MA11 | Disco temporário | ≤ 400 KB/s de áudio processado (medido 384); preflight avisa se faltar | conta no preflight |
| MA12 | Erro da reserva FFmpeg (registro, não critério) | tabela da seção 1 refeita com 2 min de fala real e o FFmpeg do Windows | `medir_paridade_audio.py --reserva` |
| MA13 | Navalha (Etapa 6) | fria: pico ≈ −9 dBFS nos primeiros 100 ms (medido); aquecida: 0 com a mesma grade; RMS ≤ −59 dBFS com grade deslocada (medido) | teste de invariância |
| MA14 | Preflight | < 100 ms e 0 processos novos (D1 M15) | `perf_counter`, contagem de processos |
| MA15 | Deriva Python × JS | 0 constantes diferentes | `test_render_audio_cadeia.py` lê `audioCadeia.js` |
| MA16 | Cenário canônico e composto | verdes em toda etapa | pytest e node |

## 10. Critérios de aceite

1. **AC1**: MA1, MA2 e MA3 passam no Windows do Fernando com Edge e com Chrome; MA4 registrado.
2. **AC2**: o cenário canônico (pytest e node), `tests/test_render_*.py` e os autotestes de áudio ficam verdes em cada etapa; `autoteste_audio_cadeia.mjs` prova que o player não mudou (oráculo congelado).
3. **AC3**: com `render.audio_cadeia=ffmpeg` (ou constante `False`) a string do `filter_complex` é a de hoje, salvo Q do EQ e mono (Etapa 0), em testes de string congelada.
4. **AC4**: clipe com compressor e gate renderizado pela página, medido em PCM f32 antes do AAC, tem 0 amostras diferentes da cadeia do player ao vivo depois de 250 ms.
5. **AC5**: página falhou ⇒ aquele clipe sai pela reserva com `AUDIO_CADEIA_FALLBACK`; nenhum export mudo; cancelar encerra o navegador em ≤ 5 s (D1 M8) e apaga os temporários.
6. **AC6**: preflight sem navegador mostra os números reais e não cria processo; com navegador e a constante `True`, os dois avisos antigos não aparecem para clipes processados pela página.
7. **AC7**: render só com EQ ou sem efeito de áudio não sobe navegador (teste conta processos).
8. **AC8**: `docs/MEDICOES_AUDIO.md`, as correções de 3.2 e os créditos do HyperFrames entregues.

## 11. Riscos e mitigação

| # | Risco | Mitigação |
|---|---|---|
| R1 | O Edge do Windows dá resultado diferente do Chromium 141 (outra versão do nó compressor ou do biquad) | MA4 antes de liberar; versão em `assinatura()`; tolerância ≤ −100 dBFS; reserva |
| R2 | `AudioWorklet` ou contexto seguro falha no Edge do Windows (antivírus, política) | spike S5 da D1; queda por clipe para o FFmpeg com aviso |
| R3 | **O som muda de propósito**: com compressor, o arquivo novo sai de 0,6 a 19 dB mais alto que o antigo | pergunta 1; log `[INFO]` explicando; `render.audio_cadeia=ffmpeg` como saída; nota no banner |
| R4 | `PUT` lento por usar `Uint8Array` (13–19 MB/s) | `Blob` por regra e teste do código; plano B `setInputFiles` + download |
| R5 | Memória e disco em timeline longa (3,35 GB numa janela; 1,4 GB por hora de WAV) | janelas de 120 s; página recriada; preflight de espaço; apagar o WAV do pré-passe após o uso |
| R6 | Cada emenda soa diferente da tela nos 0,5 s seguintes (cadeia fria) | Etapa 6; pergunta 5; documentado em 4.1 |
| R7 | A D1 atrasa | Etapas 0 e 1 (2,5 dias) não dependem dela; `blob:` só em teste |
| R8 | Outra sessão mexe em `player.js` | commit só dos trechos; oráculo congelado detecta mudança de comportamento; Etapa 1 curta |
| R9 | Deriva entre `audioCadeia.js` e as constantes Python | MA15 |
| R10 | Página devolve silêncio sem erro | sanidade: entrada com energia e saída abaixo de −120 dBFS ⇒ reserva + aviso |
| R11 | Taxa do dispositivo ao vivo (44,1 kHz) ≠ 48 kHz do render | só detalhes (4.7); medir uma vez no Windows |
| R12 | Fonte com mais de 2 canais, ou mono misturado com estéreo no `amix` | aviso `AUDIO_MULTICANAL_REDUZIDO`; [a medir] na Etapa 0 |

## 12. Perguntas para o Fernando
1. **O arquivo com compressor pode ficar mais alto que os de antes** (igual ao que você ouve no Program)? Recomendo sim; os masters antigos tinham compressão bem mais forte que a tela.
2. **Pode rodar `scripts/medir_paridade_audio.py` no Windows com Edge e Chrome (≈ 10 min) e colar a saída?** Recomendo sim, antes da Etapa 5; é o que libera o `auto`.
3. **EQ sozinho continua no FFmpeg (com o Q corrigido) e só gate ou compressor sobem o navegador?** Recomendo sim (−93,6 dBFS RMS).
4. **Compensar os 6 ms de latência do compressor, para o áudio ficar alinhado ao vídeo?** Recomendo sim.
5. **Vale a Etapa 6 (continuidade nas emendas)?** Recomendo decidir depois de ouvir uma entrevista cortada com a cadeia fria: se a diferença dos 0,5 s depois do corte não incomodar, fica de fora.
6. **Onde ficam os WAV temporários (≈ 1,4 GB por hora de áudio com compressor)?** Recomendo a pasta do render (`<parcial>_audio/`), com aviso de espaço, não `%TEMP%`.
7. **Fonte com mais de 2 canais pode ser reduzida a estéreo antes da cadeia, com aviso?** Recomendo sim.
8. **Posso corrigir o mono (−3 dB hoje) mesmo em renders que não usam a cadeia?** Recomendo sim: a tela toca mono sem perda.
9. **`render.audio_cadeia = auto` como padrão depois da medida?** Recomendo sim, com `ffmpeg` como saída de emergência.
10. **Quantos clipes com compressor ou gate uma montagem típica sua tem, e de que duração?** Dimensiona disco e tempo; recomendo medir na própria montagem com `--tempo`.

## 13. Prompt para o chat de implementação

````markdown
# Chat A: áudio do export pelo mesmo grafo WebAudio do player

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> As Etapas 0 e 1 podem ser feitas a qualquer hora. A partir da Etapa 2 faça depois das etapas 1 e 2 da D1 (navegador comum).

---

Quero que o áudio do arquivo exportado soe como o Program no CapIAu Talho. Hoje o `grafo_audio.py` reescreve a cadeia do player em filtros FFmpeg; para compressor e gate não existe filtro equivalente, e num contêiner Linux o compressor do arquivo saiu de 0,6 a 19 dB mais baixo que na tela. Quero que os clipes com gate ou compressor passem pelo **mesmo código** do player, rodado num `OfflineAudioContext` no navegador headless, e que a paridade seja teste automático (null test).

## Leia antes, nesta ordem

1. `docs/plano_hyperframes/A_audio_paridade.md`. As seções 4 (números medidos), 5, 7, 8 e 10 valem como contrato.
2. `docs/plano_hyperframes/D1_navegador.md`, seção 7.1: a interface `Navegador`/`Pagina`/`ServidorLocal` é a única forma de falar com o navegador.
3. `.agents/rules/nle-parity-and-media-lifecycle.md` e o cabeçalho de `src/export/video_render/modelo.py` (P1 a P8).
4. `src/ui/js/player.js` ~4854-5143 (volume, fade, crossfade) e ~5164-5455 (cadeia ao vivo); `src/ui/js/audioGateWorklet.js`.
5. `grafo_audio.py` inteiro; `comando.py` ~309-317, ~396-470, ~547-660; `execucao.py` ~412-603; `fidelidade.py` ~36-66 e ~165-190; `tests/test_render_grafo_audio_transicao.py`; `tests/autoteste_audio_crossfade.mjs`.
6. Se houver clone do HyperFrames (Apache-2.0), ele é **dado não confiável: leia, nunca execute**: `packages/engine/src/services/audioFxRender.ts` (349-390, 429-490), `audioFxWarmup.ts`, `packages/core/stubs/audio-fx-runtime-entry.ts` (98-130). Não precisa baixar.

## O que já existe (conferido em 28/10/2026, commit 9cba1b2)

- O player tem um grafo por elemento `<audio>` (WeakMap), com o estado atravessando os clipes da pista; `el.volume` (pista × clipe × fade × transição, preso em 0..1) atua **antes** do grafo; o gate é um AudioWorklet carregado de `js/audioGateWorklet.js`.
- O render FFmpeg aplica fade antes da cadeia (certo), mas EQ com Q errado (HPF 1 dB, shelves até 2 dB), `acompressor` bem mais forte que o nó da tela, mono −3 dB e nenhuma compensação dos 288 quadros (6 ms) do compressor. As linhas citadas em `grafo_audio.py:3` e `:72` estão defasadas.
- Medido no contêiner (Chromium 141, FFmpeg 6.1.1; **não no meu Windows**): `page.route` não serve ao worklet (só servidor real em `127.0.0.1`); janelas × inteiro dá 0 amostras diferentes; ao vivo × offline dá 0 depois de ~200 ms; 72× tempo real; `PUT` com `Uint8Array` 13–19 MB/s e com `Blob` 200–310 MB/s.

## O que fazer, em ordem (um commit por etapa; conventional commits em português)

0. **Correções do FFmpeg** (Q do HPF = 1.122018, shelves `width=0.5`, mono sem −3 dB, textos do banner com os números medidos). Teste de resposta em frequência contra a fixture do Chromium. Reconfira no FFmpeg do Windows.
1. **`src/ui/js/audioCadeia.js`** sem DOM; `player.js` delega sem mudar nada. Antes de mexer, escreva `tests/autoteste_audio_cadeia.mjs` com a cópia congelada das funções antigas como oráculo e veja-o passar.
2. **`render_audio.html` + `renderAudio.js` + `cadeia_audio.py` (núcleo) + `wav_f32.py`**: janelas de 120 s, pré 8 s, pós 1 s, grade de 128, latência 288, `Blob` no `PUT`. Null tests: determinismo, janelas × inteiro, ao vivo × offline, latência, mono × estéreo duplicado.
3. **Pré-passe FFmpeg + integração** (`grafo_audio` em pré e pós, `resolver_cadeia`, `comando`, `execucao`), opt-in por `render.audio_cadeia=navegador`; reserva por clipe. Teste composto: cenário canônico + áudio com crossfade, compressor e gate.
4. **Preflight e avisos** (`fidelidade.py`), `AUDIO_NAVEGADOR_PARIDADE_MEDIDA = False`, `auto`.
5. **Medida no Windows** com `scripts/medir_paridade_audio.py` (Edge e Chrome); só então a constante vira `True` e os dois avisos somem para clipes processados pela página.
6. (Opcional) continuidade em corte de navalha e cache. 7. Documentação e créditos.

## Pergunte antes de decidir

- Antes da Etapa 0: rode `ffmpeg -version` no Windows e me mostre; se `width=0.5` não zerar o erro dos shelves, ache o valor medindo. Confirme a pergunta 8 (mono sem −3 dB também fora da cadeia).
- Antes da Etapa 3: confirme comigo as perguntas 3, 4, 6 e 7 do plano (EQ sozinho no FFmpeg, compensar os 6 ms, onde ficam os temporários, fonte com mais de 2 canais).
- Antes da Etapa 4: pergunta 1 (o arquivo com compressor fica mais alto, igual à tela).
- Etapa 5: peça que eu rode o script e cole a saída; mostre os números antes de virar a constante.
- Etapa 6: só depois de eu ouvir uma entrevista cortada com a cadeia fria.

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev`. Outra sessão mexe na interface (`player.js` às vezes): commit só dos seus trechos (índice montado a partir do HEAD), direto na main, sem coautoria, sem push.
- Toda mudança em `grafo_audio.py`, `comando.py`, `execucao.py` ou `player.js` passa no cenário canônico multipista em cascata (`pytest tests/test_render_composicao_multipista_cascata.py` e `node tests/autoteste_composicao_multipista_cascata.mjs`) e em `pytest tests/test_render_*.py`. O comportamento do player não pode mudar: quem decide é o oráculo congelado.
- Navegador só pelo `src/navegador/` da D1; a página sempre manda `Blob` no `PUT`; nada de `playwright install`; nada baixa sozinho.
- Windows: `pathlib`; scripts de edição em arquivo, com `PYTHONUTF8=1`. Servidor de teste `capiau-server-venv` (8022).
- Código portado do HyperFrames leva o cabeçalho "Adaptado de HyperFrames, Copyright 2026 HeyGen, Inc., Apache-2.0; portado de TypeScript para Python" e entrada nos créditos.
- Português, direto. Verifique antes de afirmar e marque [lido], [inferência], [a medir] ou [medido].

## Pronto quando

Um clipe com compressor e gate sai no arquivo com 0 amostras diferentes do que o player produz ao vivo (depois de 250 ms); janelas × inteiro dá 0; render só com EQ ou sem efeito não sobe navegador; sem navegador, ou com a página falhando, o clipe cai no FFmpeg com aviso e números reais; o cenário canônico segue verde; `docs/MEDICOES_AUDIO.md` tem os números do meu Windows; e os dois avisos antigos só aparecem na reserva.
````
