# Frente E — Transcrição local Parakeet TDT 0.6B v3 via sherpa-onnx

> **Resumo** (escrito em 28/10/2026)
> - **Entrega:** motor local `nvidia_parakeet` (novo): Parakeet TDT 0.6B v3 int8 no sherpa-onnx, no `.venv` principal, em subprocesso; tempo por palavra, pontuação e maiúsculas; entrada em Modelos locais (670 MB, hash, créditos CC-BY-4.0), opção em Configurações e medição em `scripts/asr_comparar.py`.
> - **Valor:** português local sem NeMo nem PyTorch, sem o laço de repetição do Canary e, por estimativa, 3 a 8 vezes mais rápido que o Whisper turbo (0,4×) [a medir]; abre caminho para aposentar o Canary (6,4 GB).
> - **Esforço:** ≈ 5,5 dias no núcleo (etapas 0 a 7); opcionais: +0,75 d (remendo de fala perdida) e +2 d (diarização sherpa).
> - **Dependências:** `sherpa-onnx` no `.venv` (hoje fora do `requirements.txt`); você baixar 670 MB; gabaritos do chat 06 (item 5) para o gate. Nenhuma outra frente.
> - **Principal risco:** o português do treino é **europeu** (cartão do modelo); fala brasileira espontânea e ruidosa não aparece nos benchmarks (FLEURS pt_br 4,76 % é fala lida).
> - **Decisão principal:** subprocesso com o mesmo Python (não dentro do servidor) e Parakeet como opção local, **não** padrão, até passar o gate da seção 9.

## 1. Objetivo e valor

**Objetivo.** Um motor de transcrição local com o mesmo contrato dos demais: recebe `(audio, plano, opcoes, chave)` e devolve `ResultadoASR` com palavras `{word, start_time, end_time, speaker_id, confidence}` em segundos (`src/transcription/motores.py:7-9,79-85`), sem o pipeline saber qual motor rodou.

**Valor, com a evidência de cada item**

1. **Tira o NeMo do caminho do português local.** Hoje o local "bom" é o Canary: 6,4 GB, `.venv-nemo` com torch, NeMo 3.0.0 e transformers 5.18 (`requirements-nemo.txt:1-20`, `modelos_locais.py:94-100`), ~1,5× o áudio (`docs/proximos_chats/README.md:61-64`).
2. **Robustez.** O Canary entrou em laço num clipe (README:61-62; `motores.py:468-469`). O TDT é um transdutor que emite "branco" no silêncio; o risco típico passa de "repetição" para "fala perdida" (4.2) [inferência].
3. **Texto pronto.** O cartão do modelo diz "Punctuations and Capitalizations included" [lido: hf://models/nvidia/parakeet-tdt-0.6b-v3/README.md].
4. **Custo.** AssemblyAI custa US$ 0,31/h com diarização e entidades (`motores.py:487-488`; `tests/test_motores_asr.py:321`); motor local custa 0 (`motores.py:495-505`), coerente com "o sistema é barato, não offline" (README:44-45).
5. **Correção da pesquisa anterior.** O ganho **não** é "ter tempo por palavra sem NeMo": o Whisper local já devolve (`motores.py:290-299,326-327`). O ganho é velocidade, estabilidade, texto pronto e a chance de aposentar o Canary.

**Fora do escopo:** trocar o padrão global (continua AssemblyAI); streaming; GPU; remover Canary, SenseVoice ou `.venv-nemo` (decisão sua, depois da medição).

| Motor local | Onde roda | Tempo na CPU i7-10700 | Tempo por palavra | Peso | Nota |
|---|---|---|---|---|---|
| Whisper large-v3-turbo | `.venv` (faster-whisper) | ~0,4× [README:62-63, medido] | sim, com `probability` | 1,6 GB | pontuação em `word` |
| Canary 1B v2 | `.venv-nemo` (NeMo) | ~1,5× [README:62-63, medido] | sim, confiança fixa 1.0 | 6,4 GB | laço em áudio ruidoso |
| SenseVoice Small | `.venv-nemo` (FunASR) | n/d | sim, confiança 1.0 | 0,9 GB | só zh/en/ja/ko/yue |
| **Parakeet v3 int8 (novo)** | `.venv` + subprocesso | **a medir** (estimativa 0,05-0,15×) | sim, grade de 80 ms | 670 MB | pt europeu no treino |

## 2. Estado atual no Talho (arquivo:linha; invariantes)

| Peça | Onde | Fato [lido] |
|---|---|---|
| Contrato | `motores.py:7-9,59-85` | `ErroASR`, `PlanoASR`, `OpcoesASR(idioma, diarizar, max_falantes, detectar_entidades, whisper_modelo)`, `ResultadoASR` |
| Tabelas de motores | `motores.py:18-30,44-56,510-516` | `MOTOR_*`, `TRANSCRICAO_COM_DIARIZACAO`, `TRANSCRICAO_LIGADOS`, `DIARIZADORES_SEPARADOS`, `MOTORES` |
| Resolução e quedas | `motores.py:88-129` | idioma/motor sem suporte vira AssemblyAI + aviso (96-107); sem diarização própria vira `SEM_DIARIZACAO` + aviso (110-115) |
| Whisper em processo | `motores.py:276-335` | 8 threads em 16 lógicos (284); palavras com pontuação (297); `audio_16k` ffmpeg→numpy (302-317) |
| Worker do `.venv-nemo` | `motores.py:340-392`, `venv_nemo_worker.py:1-17,155-170` | subprocesso, WAV 16 kHz, JSON de saída, timeout 1800 s, `HF_HUB_OFFLINE=1`; "não importa nada de `src`" (6) |
| Canary, SenseVoice | `motores.py:401-409,424-434` | confiança 1.0 + aviso; sem diarização própria |
| Diarização separada | `motores.py:395-421,437-460,529-532` | segmentos `{inicio,fim,falante}` + `atribuir_falantes`: contrato reaproveitável |
| Alucinação | `motores.py:465-481,526-528` | `repeticao_em_loop` roda para **todo** motor |
| Pipeline | `src/services/pipeline.py:581-694` | `resolver_motores` (597); áudio MP3 (626-631); `ErroASR`→`PipelineError` (642-644); grava palavras (655) |
| Lote | `src/worker_transcricao.py:1-30,132` | processo próprio, 1 vídeo por vez; a rota individual roda dentro do servidor (14-19) |
| Catálogo | `src/services/modelos_locais.py:29-43,70-149,192-229,242-305` | `ModeloLocal`, `baixado`, `exigir`, `baixar` (HF `snapshot_download`) |
| Tela e rota | `src/ui/js/modelosLocais.js:1-26`, `src/api/routes/modelos.py:1-26` | lista, estado, botão baixar; `ROTULO_CONFIG` |
| Configurações | `src/services/settings_registry.py:159-212` | `transcription.engine` (enum+rótulos 161-168), `asr.language` = pt/en/es (206-207) |
| sherpa no denoise | `src/media/audio_denoise.py:6-12,78-126,314-359`; `settings_registry.py:1213` | import preguiçoso, `motor_disponivel()` devolve motivo; cita sherpa-onnx **1.13.6** (328) |
| Avaliação | `scripts/asr_comparar.py:28-44,56-125` | WER sem S/D/I; referência = 1º motor da lista |
| Testes | `tests/test_motores_asr.py:289-296,347-357`, `tests/test_modelos_locais.py` | motores falsos por `monkeypatch`; sem rede, sem modelo |

**Invariantes que a frente não pode quebrar**

- I1. Contrato único de saída (palavra com 5 campos, tempos em segundos).
- I2. Nada baixa sozinho; todo motor chama `exigir()` antes de carregar (`modelos_locais.py:218-229`).
- I3. Motor novo entra em `TRANSCRICAO_COM_DIARIZACAO` junto com código e teste (`motores.py:44-45`); enum de Configurações e `TRANSCRICAO_LIGADOS` andam juntos (`tests/test_motores_asr.py:35-39` falha se o rótulo disser "em teste" e houver código, ou o contrário).
- I4. Idioma/motor sem suporte cai num caminho que funciona e **avisa** (`motores.py:3-5`).
- I5. Import de `sherpa_onnx` só dentro de funções (`audio_denoise.py:6-12`); o módulo precisa importar sem o pacote.
- I6. Sem mudança de schema: tabela `transcript` (`src/db/schema.py:173-181`) segue igual.

**Achados no caminho**

- F1. `sherpa-onnx` **não** está em `requirements.txt` [lido: 1-33], mas `audio_glossario.py:25` diz "instalados" e `audio_denoise.py:328` cita 1.13.6. Confirmar com `pip show` [a medir].
- F2. `exigir()` manda "ver requirements-opcional.txt" (`modelos_locais.py:224`); o arquivo não existe na raiz.
- F3. A ajuda de `transcription.engine` promete "sem ele, a transcrição sai pela AssemblyAI" (`settings_registry.py:170`), mas o código levanta `ErroASR` (`motores.py:351-357`→`pipeline.py:643-644`) e o vídeo vai para `error`. Só falta de código ou de idioma cai na AssemblyAI.
- F4. `pipeline.py:646` só imprime o motor; nenhuma coluna guarda qual motor transcreveu cada vídeo.
- F5. A régua do README ("WER contra a AssemblyAI: Deepgram ~77 %, Whisper turbo ~50 %", 61-62) não diz se é erro ou concordância; o relatório da etapa 7 precisa dizer.

## 3. O que o HyperFrames tem (portar / adaptar / inspirar-se)

Tudo [lido]; código Apache-2.0, "Copyright 2026 HeyGen, Inc." (`HF:CREDITS.md`; modelo CC-BY-4.0 e sherpa-onnx Apache-2.0 em `HF:CREDITS.md:31-35`).

| Peça | O que faz | Decisão | Destino |
|---|---|---|---|
| `HF:packages/cli/src/whisper/parakeet.ts:109-124` `mergeTokensToWords` | token com espaço inicial (ou o 1º) abre palavra; o resto cola; descarta vazias | **Portar** | `tokens_para_palavras` (novo) |
| `parakeet.ts:136-145` `mergeWindowsToWords` | tempo = deslocamento da janela + `timestamps[i]`; fim = início + `durations[i]` (0 se faltar) | **Portar** | idem |
| `parakeet.ts:242-274` `silenceCuts` | janelas de ~60 s; cada corte vai para o bloco de 100 ms mais quieto em ±5 s | **Portar** (numpy) | `janelas_por_silencio` (novo) |
| `parakeet.ts:157-171,211-240` `droppedSpeechGaps`, `spliceGap`; `sherpaWorker.ts:54-85` | acha ≥ 1 s sem token e com energia > 0,3× a média, redecodifica o trecho com folga e pad de 0,5 s, emenda sem duplicar | **Portar na etapa 8**, só se a medição pedir | `sherpa_palavras.py` |
| `HF:.../sherpa.ts:338-354` `recognizerConfig` | `featureDim 80`, `sampleRate 16000`, `numThreads 4`, `modelType "nemo_transducer"`, `greedy_search` | **Adaptar** | `from_transducer(...)` (4.1) |
| `sherpa.ts:46-80,292-336`, `modelFile.ts:17-20` | revisão do HF fixada (`2bda32ec70b097a55adaa07d9a7173915b43cc78`), tamanho e sha256 por arquivo, pasta temporária e renomeação | **Adaptar** | catálogo + verificação pós-download |
| `sherpa.ts:382-426`, `sherpaWorker.ts:87-93` | decodifica em processo filho ("onnxruntime aborta o processo inteiro em algumas entradas, sem exceção"); protocolo de linhas com prefixo | **Inspirar-se** | `sherpa_worker.py` (JSON em arquivo, como `venv_nemo_worker.py:167-168`) |
| `sherpa.ts:83-84` `decodeTimeoutMs` | máx(30 min, 2 s por s de áudio) | **Portar** a fórmula | substitui o 1800 fixo (`motores.py:342`) |
| `sherpa.ts:111-122`, `parakeet.ts:34-41` | motivo de "não roda aqui"; lista de 25 idiomas (`pt-BR` conta como `pt`) | **Adaptar** | `IDIOMAS_PARAKEET`, `parakeet_disponivel()` |
| `parakeet.ts:44-85,284-336`, `parakeetRunner.ts` | runner `parakeet-mlx` (Apple Silicon) | **Não portar** | irrelevante no Windows |
| `sherpa.ts:38-44,234-263` | instala `sherpa-onnx-node` por npm | **Não portar** | aqui é `pip` |

**Diferenças a registrar**

- O HF **não sobrepõe** janelas: os cortes vão para o silêncio e cada amostra pertence a uma janela só; a "folga" é a busca de ±5 s. O pedido desta frente falou em "janelas fixas com sobreposição como o HF"; não é o que o código faz.
- O comentário `parakeet.ts:3-9` (6,05 % contra 7,44 %; 4,73 % contra 5,96 % no ruidoso) é de outro modelo e outra língua: o cartão do v3 traz 6,34 % no leaderboard em **inglês** [lido: model card]. Esses números não dizem nada sobre português.
- Porte linha a linha é obra derivada de Apache-2.0: manter cabeçalho de atribuição e entrada em `CREDITOS_TERCEIROS.md` (novo). Apache-2.0 → GPLv3 é compatível (no sentido Apache → GPL) [inferência; não é parecer jurídico].
- Testes do HF para portar os casos: `parakeet.test.ts` (172 linhas), `sherpa.test.ts` (487), `sherpaWorker.test.ts` (166) [só o tamanho foi lido].

## 4. Verificações de viabilidade

Limite desta pesquisa: `k2-fsa.github.io` não resolve nesta sessão (rede restrita). Li o código-fonte no GitHub (`raw.githubusercontent.com`), o `.rst` da documentação no repositório `k2-fsa/sherpa` e o Hugging Face.

### 4.1 API Python do sherpa-onnx — veredito: **viável (confirmado no código, falta a sonda)**

- **Arquivos** [lido: hf://models/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8; sha256 de `HF:.../sherpa.ts:61-78`, não recalculado]:

| Arquivo | Bytes | sha256 (início) |
|---|---|---|
| `encoder.int8.onnx` | 652.184.281 | `acfc2b44…2247` |
| `decoder.int8.onnx` | 11.845.275 | `179e50c4…db4e` |
| `joiner.int8.onnx` | 6.355.277 | `3164c13f…48b3` |
| `tokens.txt` | 93.939 | `d5854467…35d` |

  Total 670.478.772 B ≈ 670 MB (a doc diz "640M" em MiB) [web: raw.githubusercontent.com/k2-fsa/sherpa/master/docs/source/onnx/pretrained_models/offline-transducer/nemo/parakeet-tdt-0.6b-v3.rst]. O repositório tem ainda `test_wavs/` e **não tem README nem licença próprios**: vale a licença do modelo original.
- **Chamada.** `OfflineRecognizer.from_transducer(encoder, decoder, joiner, tokens, num_threads=1, sample_rate=16000, feature_dim=80, decoding_method="greedy_search", …, provider="cpu", model_type="transducer", blank_penalty=0.0, …)`; o docstring não explica `model_type` [web: raw…/sherpa_onnx/offline_recognizer.py]. O valor para o Parakeet é `nemo_transducer` (CLI da doc: `--model-type=nemo_transducer`; HF: `modelType: "nemo_transducer"`, `sherpa.ts:350`).
- **Esboço [inferência: nomes `create_stream`/`decode_stream`/`result` são a API usual; confirmar na sonda]:**

```python
import sherpa_onnx
r = sherpa_onnx.OfflineRecognizer.from_transducer(
    encoder=str(p/"encoder.int8.onnx"), decoder=str(p/"decoder.int8.onnx"), joiner=str(p/"joiner.int8.onnx"),
    tokens=str(p/"tokens.txt"), num_threads=8, sample_rate=16000, feature_dim=80,
    decoding_method="greedy_search", model_type="nemo_transducer")
s = r.create_stream(); s.accept_waveform(16000, amostras_float32); r.decode_stream(s)
res = s.result   # .text .tokens .timestamps .durations .ys_log_probs
```
- **Resultado.** O binding Python expõe `text, lang, emotion, event, tokens, words, timestamps, durations, ys_log_probs, segment_timestamps, segment_durations, segment_texts` [web: raw…/python/csrc/offline-stream.cc]. `durations` e `ys_log_probs` existem; se vêm preenchidos para o TDT é [a medir] (etapa 0). O HF lê `durations` do binding Node (`parakeet.ts:126-132`).
- **Pontuação e maiúsculas:** sim; "All transcriptions preserve punctuation and capitalization" [model card]. A doc do sherpa não comenta.
- **Versão.** A doc não fixa mínimo ("use sempre a mais recente"; exemplo de APK 1.12.40 já com v3). O HF fixa `sherpa-onnx-node` **1.13.8** (`HF:packages/cli/src/utils/optionalPackages.ts:35`). Esta máquina tem **1.13.6** (`audio_denoise.py:328`). O PyPI está em **2.0.1** (arquivos de 26-27/10/2026), com wheel `win_amd64` para cp310 a cp314, ~2,2 MB cada [web: pypi.org/pypi/sherpa-onnx/2.0.1/json]. Regra: usar `>=1.13.6` se a sonda mostrar `durations` na 1.13.6; senão `>=1.13.8`; **não** pular para 2.x antes do gate (major com um dia de idade; o denoise usa nomes da 1.13.6).

### 4.2 Áudio longo — veredito: **precisa de janelas; usar o corte no silêncio do HF**

- Limite do modelo: "até 24 minutos com atenção total (A100 80 GB) ou 3 horas com atenção local"; "pelo menos 2 GB de RAM para carregar" [model card]. A atenção cresce com o quadrado do tempo; em CPU o arquivo inteiro não é opção [inferência].
- A doc do sherpa manda usar o exemplo com **VAD** para áudio muito longo [web: o `.rst` acima].
- HF: janelas de 60 s, corte no bloco de 100 ms mais quieto em ±5 s, sem sobreposição (`parakeet.ts:259-274`). Recomendo isto na etapa 2 por não precisar de outro modelo e por ter sido calibrado com testes; VAD do sherpa (`silero_vad.onnx`) fica como alternativa se a medição mostrar palavras partidas ou tempo perdido em silêncio.
- **Emenda sem duplicar nem perder:** como as janelas não se sobrepõem, não há duplicata por construção. Invariantes de teste: (i) soma das janelas = áudio inteiro; (ii) tempo = deslocamento + tempo local, exato ao milissegundo; (iii) início de palavra nunca regride; (iv) últimas 3 palavras da janela k ≠ primeiras 3 da k+1 (comparação por letras); (v) arquivo < 60 s = 1 janela.
- Risco: sem pausa ≥ 100 ms em ±5 s o corte cai dentro de palavra. Medida M11 (seção 9). Plano B: sobreposição de 2 s com remoção por tempo, só se M11 reprovar.

### 4.3 Tokens → palavras — veredito: **viável; porte direto com 3 ajustes**

| Caso | HF (`parakeet.ts:109-124`) | Talho |
|---|---|---|
| Início de palavra | token começa com espaço, ou é o primeiro | aceitar `"▁"` **e** espaço: o prefixo real em Python é [a medir] (etapa 0) |
| Fim da palavra | `end` do último token (início + duração) | idem, limitado ao início da próxima palavra e a 0,32 s (4 quadros) [inferência] |
| Pontuação colada (`,` `.`) | sem espaço, cola na anterior | idem; o Whisper também guarda pontuação em `word` (`motores.py:297`) |
| Pontuação isolada (`▁—`, `▁?`) | vira "palavra" | **ajuste 1:** colar na anterior; abre-aspas/parêntese cola na próxima |
| Números (`1`, `,`, `5` → `1,5`) | cola | idem; dígitos × extenso e `R$ 100` [a medir] |
| Hífen (`guarda-chuva`) | uma palavra | idem |
| Duração ausente | 0 (`parakeet.ts:141`) | **ajuste 2:** fim = início da próxima palavra, teto 0,32 s |
| Confiança | não existe | **ajuste 3:** média das probabilidades de `ys_log_probs` por palavra; se vier vazio, 1.0 + aviso, como o Canary (`motores.py:406`) |

A grade dos tempos é de 80 ms (8 quadros de 10 ms) [inferência: arquitetura FastConformer]; erro de corte de até ~80 ms é esperado e medido em M8/M9.

### 4.4 Desempenho na CPU — veredito: **sem medição oficial; estimativa favorável; medir**

| Fonte | Número | Máquina / runtime | Confiança |
|---|---|---|---|
| Medido pelo Fernando [README:62-63] | Whisper turbo ~0,4×; Canary ~1,5× | i7-10700 | alta |
| BenchLM [web: benchlm.ai/models/parakeet-tdt-0-6b-v3] | 16,5× tempo real (RTF ≈ 0,06) | M5 MacBook Air, sherpa-onnx int8 | baixa: agregador, só o resumo da busca |
| groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai [web: github.com/groxaxo/…] | RTF 0,054 INT8; 29,7× (i7-12700KF) e 17,0× (i7-4790) | não diz se é sherpa | baixa: só o resumo da busca |
| Reddit/aicompass [web: bittide.aicompass.dev/article/cf69f0e5-d5d9-4cf3-a36d-fc6800a4bff0] | RTF 0,328 em FP32 | 2 núcleos x86, onnx-asr | baixa |
| `HF:sherpa.ts:83-84` | teto de 2 s por s de áudio no timeout | CPU lenta | limite de segurança, não medida |

- Estimativa para o i7-10700 (8 núcleos, AVX2): **RTF 0,05 a 0,15** [inferência: o i7-4790 de 4 núcleos já aparece a 17×]. Alvo de aprovação 0,25 (seção 9).
- Memória: encoder int8 de 622 MiB em disco; pico do processo estimado em 1 a 1,5 GB [inferência]; "pelo menos 2 GB" para carregar [model card]. Threads: HF usa 4 (`sherpa.ts:347`), o Whisper do Talho usa 8 (`motores.py:284`); testar 4 e 8 (M2).
- Carga do modelo: sem número; Canary leva ~25 s com a pasta descompactada (`venv_nemo_worker.py:27-29`). Alvo ≤ 6 s.

### 4.5 Diarização offline do sherpa-onnx — veredito: **viável, qualidade desconhecida; recomendada só como etapa opcional**

| Componente | Arquivo / tamanho | Licença | Nota |
|---|---|---|---|
| Segmentação pyannote 3.0 em ONNX | `model.onnx` 5,99 MB, `model.int8.onnx` 1,54 MB (`csukuangfj/sherpa-onnx-pyannote-segmentation-3-0`, público) [lido: hf_fs] | repo traz `LICENSE` de 1.061 B; o original é MIT [inferência: ler antes de distribuir]; o original no HF é restrito (acesso negado nesta sessão) | cópia ONNX sem portal de termos |
| Reverb diarization v1 | `model.onnx` 9,1 MB | "non-commercial" [web: `…/speaker-diarization/models.rst`] | **descartar** |
| Embeddings | `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`, `nemo_en_titanet_small.onnx` (GitHub, tag `speaker-recongition-models`) | não informada; tamanhos não informados | treinados em zh / en: sotaque pt-BR [a medir] |
| Agrupamento | `FastClustering` (limiar ou nº de falantes) | — | sem VBx |
| Atual: pyannote community-1 | no `.venv-nemo` | CC-BY-4.0, **com** formulário/termos no HF [lido: README do repo] | `modelos_locais.py:109-115` |

- A doc não traz DER nem tempo [web]. A medição de referência do Fernando: clipe 517 (2 pessoas): pyannote 2, Nemotron 4, AssemblyAI 2 (README:64).
- **Substitui o `.venv-nemo`?** Só nos dois diarizadores (Nemotron e pyannote), que são os que exigem torch/transformers 5.18/pyannote.audio (`requirements-nemo.txt:14-19`). Canary e SenseVoice continuam exigindo o `.venv-nemo`. Para aposentá-lo é preciso abandonar os dois.
- **Encaixe:** `DIARIZADOR_SHERPA = "sherpa_pyannote"` (novo) em `DIARIZADORES_SEPARADOS` (`motores.py:50`) e `diarizar_separado` (418-421); mesma saída `[{inicio, fim, falante}]` (`venv_nemo_worker.py:62,92`) e mesma `atribuir_falantes`. `resolver_motores` já trata separados (124-125). Download dos embeddings é do GitHub, não do HF: exige `_baixar_url` com hash (novo).
- **Recomendação:** etapa 9, **depois** do gate do Parakeet e só se você quiser aposentar o `.venv-nemo`. Critério para adotar: nº de falantes certo em ≥ o mesmo que o pyannote community-1 nos clipes do gabarito e DER no máximo 3 pontos acima.

### 4.6 Português do Brasil no treino — veredito: **cobre, mas com variante europeia declarada**

- Cartão: "our training data uses European Portuguese while most benchmarks use Brazilian Portuguese" (Nota 2) [lido: model card]. O cartão lista 25 idiomas, `pt` entre eles, e **detecta o idioma sozinho**: não há parâmetro de idioma [lido].
- Dados: ~660.000 h pseudo-rotuladas do Granary (YTC, MOSEL, YODAS) + ~10.000 h humanas (NeMo ASR Set 3.0, com MLS e Common Voice 7.0), ajuste final de ~7.500 h [lido: model card; paper_2509_14128.txt:117,258]. O artigo põe o português entre os idiomas de "muito mais horas" e fora da dominância do VoxPopuli (txt:137,139). **Horas exatas de pt: não encontradas** (Apêndice A ausente do texto parcial) [não lido].
- WER em fala lida, decodificação gulosa, sem pontuação e caixa [model card]: **FLEURS pt_br 4,76 %**, MLS pt 7,50 %, CoVoST2 pt 3,96 % (es: 3,45 / 4,39 / 3,41; fr: 5,15 / 4,97 / 6,05).
- Ruído (inglês, MUSAN): WER médio 6,34 % limpo → 7,12 % (SNR 10) → 8,23 % (5) → 11,66 % (0) → 19,88 % (-5) [model card]. Bastidor com vento/equipe é o pior caso do Fernando.
- Riscos: sotaque regional e fala espontânea não medidos; confusão pt/es/it em trechos curtos sem como forçar o idioma; fala sobreposta (um só canal); números e siglas. Mitigação nas seções 9 e 11.

### 4.7 Avaliação antes de virar padrão — veredito: **o script atual não basta; estender**

`scripts/asr_comparar.py` hoje: WER sem S/D/I (34-44), referência = 1º motor (111-117), sem gabarito, sem tempo de palavra, sem silêncio, sem RTF. O chat 06 (item 5) já prevê `--gabarito`; **conferir se existe antes de criar**. Extensão (etapa 6): `wer_detalhado` (S/D/I); `--gabarito`; `--referencia`; `--tempo` (alinhar palavras iguais por LCS e medir |Δ início| e |Δ fim|); `--silencio` (palavras/min e laços em trechos sem fala); RTF e pico de memória no JSON. Números-alvo: seção 9.

**Fontes web consultadas em 28/10/2026**

- Código: https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/sherpa-onnx/python/sherpa_onnx/offline_recognizer.py e https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/sherpa-onnx/python/csrc/offline-stream.cc
- Documentação (fonte `.rst`): https://raw.githubusercontent.com/k2-fsa/sherpa/master/docs/source/onnx/pretrained_models/offline-transducer/nemo/parakeet-tdt-0.6b-v3.rst e https://raw.githubusercontent.com/k2-fsa/sherpa/master/docs/source/onnx/speaker-diarization/models.rst
- Pacote: https://pypi.org/pypi/sherpa-onnx/2.0.1/json
- Hugging Face: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3, https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8, https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0, https://huggingface.co/pyannote/speaker-diarization-community-1
- Desempenho (só resumos de busca): https://benchlm.ai/models/parakeet-tdt-0-6b-v3, https://github.com/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai, https://bittide.aicompass.dev/article/cf69f0e5-d5d9-4cf3-a36d-fc6800a4bff0
- Artigo: arXiv 2509.14128, texto parcial já baixado (`paper_2509_14128.txt`).

## 5. Decisões de projeto

| # | Decisão | Alternativas | Recomendação | Motivo |
|---|---|---|---|---|
| D1 | Onde roda | (a) import no servidor; (b) subprocesso `python -m src.transcription.sherpa_worker` (novo) com `sys.executable`; (c) dentro do `.venv-nemo` | **(b)** | HF isola por aborto do onnxruntime (`sherpa.ts:382`); a rota individual roda no servidor (`worker_transcricao.py:14-19`) e uma queda derrubaria a API; libera ~1 a 1,5 GB ao fim; evita misturar a DLL `onnxruntime` do pip (faster-whisper) com a do sherpa no mesmo processo Windows [inferência, testar]; (c) traria torch sem necessidade. Custo de (b): recarregar o modelo a cada vídeo (M3 ≤ 6 s); se pesar em lote de clipes curtos, o worker passa a receber vários arquivos |
| D2 | Nome | `parakeet_sherpa` (pesquisa), `nvidia_parakeet` | `nvidia_parakeet` | o valor fica gravado nas Configurações; nomear pelo modelo, como `nvidia_canary`, e não pelo runtime |
| D3 | Segmentação | arquivo inteiro; sobreposição; 60 s no silêncio (HF); VAD silero | 60 s no silêncio | 4.2 |
| D4 | Fala perdida | ignorar; remendo do HF; `blank_penalty` | medir primeiro; se D > 3 % testar `blank_penalty` (1 linha), depois o remendo (etapa 8) | `blank_penalty` existe em `from_transducer`; se o decodificador NeMo/TDT o aplica é [a medir] |
| D5 | Download | HF cache + `snapshot_download`; `data/models/` como o denoise | HF cache, revisão fixa, sha256 ao fim | reaproveita `baixar`/`baixado`; o denoise tem script manual (`scripts/baixar_modelo_denoise.py`) |
| D6 | Diarização | nenhuma própria + separados atuais; sherpa | nenhuma própria agora; sherpa na etapa 9 | `TRANSCRICAO_COM_DIARIZACAO[...] = False` já funciona com Nemotron/pyannote (`motores.py:529-532`) |
| D7 | Idioma | sem controle; aviso | `IDIOMAS_PARAKEET` + queda para AssemblyAI como o SenseVoice (`motores.py:101-104`) + aviso se o texto parecer de outra língua | o modelo detecta sozinho |
| D8 | Padrão global | Parakeet vira padrão? | **Não**; "local recomendado" só após o gate | README:41-49 (decisões já tomadas) |
| D9 | Falta de modelo | erro com instrução; cair na AssemblyAI | erro com instrução, como Whisper e Canary; corrigir o texto da ajuda (F3) | não gastar nuvem sem você saber |
| D10 | Dependência | `requirements.txt`; `requirements-opcional.txt` (novo) | `requirements.txt` (pergunta 1) | wheel de ~2 MB, precedente do faster-whisper (`requirements.txt:11-12`) |

## 6. Modelo de dados e compatibilidade

- **Banco:** sem migração. `transcript` fica igual (`src/db/schema.py:173-181`). `speaker_id` = "Desconhecido" até um diarizador separado rodar (como o Whisper, `motores.py:298`); `confidence` = probabilidade média da palavra ou 1.0 com aviso.
- **Transcrições já feitas:** intactas. Reprocessar exige `--force` (`worker_transcricao.py:78-79`) ou a rota. Ao regravar, `transcript_theme` depende de `transcript` com `ON DELETE CASCADE` (`schema.py:194-199`) e o pipeline reatribui temas (`pipeline.py:679-680`); se `save_transcript_words` (`src/db/repositories/narrative.py:7`) apaga as linhas antigas é [a conferir] antes de reprocessar em massa.
- **Auditoria:** nenhuma coluna guarda o motor por vídeo (F4). Uma coluna `asr_engine` (novo) em `video` mexe em schema: frente separada (pergunta 8).
- **Configurações:** um valor novo no enum `transcription.engine`; padrão e projetos antigos intactos; `requires_reprocess` já é `True` (`settings_registry.py:172`). `asr.language` = pt/en/es: os três são idiomas do modelo.
- **Catálogo:** quatro campos opcionais novos em `ModeloLocal` (`licenca`, `creditos`, `revisao`, `hashes`; padrão vazio, então os 20+ modelos atuais não mudam) e uma função `pasta_do_modelo()` (nova) que acha o snapshot com os 4 arquivos (mesma busca de `_no_cache_hf`, `modelos_locais.py:172-175`). Esboço:

```python
ModeloLocal(
    id="parakeet_tdt_v3_int8", nome="NVIDIA Parakeet TDT 0.6B v3 (int8, sherpa-onnx)",
    uso="Transcrição local na CPU, 25 línguas, tempo por palavra, pontuação e maiúsculas",
    tamanho_mb=670, ambiente="principal", pacotes=("sherpa_onnx",),
    repo="csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
    padroes=ARQUIVOS, marcadores=ARQUIVOS,  # encoder/decoder/joiner .int8.onnx + tokens.txt
    revisao="2bda32ec70b097a55adaa07d9a7173915b43cc78", hashes=(...),  # HF:sherpa.ts:61-78
    configuracao=("transcription.engine=nvidia_parakeet",), idiomas=IDIOMAS_PARAKEET,
    licenca="CC-BY-4.0",
    creditos="Parakeet TDT 0.6B v3 © NVIDIA, CC-BY-4.0. Export int8/ONNX de csukuangfj (k2-fsa/sherpa-onnx); a quantização é modificação.",
    obs="Detecta o idioma sozinho. Treino em português europeu (cartão do modelo).")
```
  `tests/test_modelos_locais.py:23-27` exige `tamanho_mb`, `uso`, `configuracao`, `repo` e `marcadores`: atendido.
- **Atribuição CC-BY visível:** a linha do modelo na tela mostra licença, créditos e link; `CREDITOS_TERCEIROS.md` (novo) lista NVIDIA (CC-BY-4.0), sherpa-onnx (Apache-2.0) e o código adaptado do HyperFrames (Apache-2.0, HeyGen). O Talho não redistribui os pesos (o download sai direto do Hugging Face), mas CC-BY pede crédito e aviso de modificação, e mostrar custa pouco [inferência; não é parecer jurídico].

## 7. Mudanças por arquivo

| Arquivo | Mudança | Etapa |
|---|---|---|
| `scripts/sherpa_sonda.py` (novo) | imprime versão, propriedades do resultado, 15 primeiros tokens com prefixo literal, `timestamps`, `durations`, `ys_log_probs`, RTF e memória em 1 clipe | 0 |
| `requirements.txt` | `sherpa-onnx>=1.13.6` ou `>=1.13.8` (regra de 4.1), com comentário "pacote leve; o modelo vem de Modelos locais" | 0 |
| `src/transcription/sherpa_palavras.py` (novo) | `tokens_para_palavras`, `janelas_por_silencio`, `reconhecer_longo`; (etapa 8) `trechos_perdidos`, `emendar_trecho`; cabeçalho de atribuição ao HF | 1, 2, 8 |
| `src/services/modelos_locais.py` | campos novos em `ModeloLocal` (29-43); entrada (70-149); `revisao` em `_baixar_hf` (242-253); `verificar_arquivos`; `pasta_do_modelo`; `licenca`/`creditos` em `estado()` (202-211); mensagem de 224 aponta `requirements.txt` | 3 |
| `src/ui/js/modelosLocais.js` | licença e créditos na linha do modelo | 3 |
| `CREDITOS_TERCEIROS.md` (novo) | créditos e licenças | 3 |
| `src/transcription/sherpa_worker.py` (novo) | `python -m src.transcription.sherpa_worker transcrever <wav> <saida.json> <pasta> <threads>`; lê o WAV com `wave`+numpy (sem dependência nova); JSON `{modelo, sherpa_onnx, carga_s, inferencia_s, palavras:[{word,start,end,confidence}], avisos}`; (etapa 9) tarefa `diarizar` | 4, 9 |
| `src/transcription/motores.py` | `MOTOR_PARAKEET`, `IDIOMAS_PARAKEET` (18-25); `TRANSCRICAO_COM_DIARIZACAO` (46-47); queda por idioma em `resolver_motores` (após 104); `_converter_wav_16k` extraído de `_rodar_worker_nemo` (378-381); `_rodar_worker_sherpa`; `transcrever_parakeet`; `MOTORES` (510-516); timeout `max(1800, 2×duração)`; (9) `DIARIZADOR_SHERPA` | 4, 9 |
| `src/services/settings_registry.py` | enum e rótulo em 161-168 (sem "em teste"); ajuda de 170 corrigida; (9) `diarization.engine` | 5, 9 |
| `scripts/asr_comparar.py` | `wer_detalhado`, `--gabarito`, `--referencia`, `--tempo`, `--silencio`, RTF/memória no JSON | 6 |
| `tests/test_sherpa_palavras.py`, `tests/test_asr_comparar.py` (novos); `tests/test_motores_asr.py`, `tests/test_modelos_locais.py` | seção 9 | 1-6 |
| `docs/MEDICAO_PARAKEET.md` (novo) | números, método e decisão do gate | 7 |
| **Sem mudança** | `venv_nemo_worker.py`, `worker_transcricao.py`, `pipeline.py`, `media.py:956` (preço 0 para local), `schema.py` | — |

## 8. Etapas (cada uma = um commit)

**Etapa 0 — sonda e dependência (0,25 d).** Commit: `chore(transcricao): sonda do sherpa-onnx e do Parakeet, sem mudar comportamento`. Conteúdo: `scripts/sherpa_sonda.py` + linha no `requirements.txt`. Resolve os [a medir] de 4.1/4.3: prefixo `▁` ou espaço, `durations` e `ys_log_probs` preenchidos, `words`, RTF com 4 e 8 threads, memória. Testes: nenhum automático (script manual). Depende de: modelo baixado à mão por você (decisão sua) e `sherpa-onnx` instalado.

**Etapa 1 — tokens em palavras (0,75 d).** Commit: `feat(transcricao): junta tokens do Parakeet em palavras com tempo e confiança`. Conteúdo: `tokens_para_palavras` com as regras de 4.3 e cabeçalho de atribuição. Testes: `tests/test_sherpa_palavras.py` (prefixo `▁` e espaço; pontuação colada e isolada; número; hífen; duração ausente; palavra vazia; deslocamento de janela; início nunca regride). Depende de: etapa 0.

**Etapa 2 — janelas no silêncio (1 d).** Commit: `feat(transcricao): janelas de 60 s cortadas no silêncio, sem sobreposição`. Conteúdo: `janelas_por_silencio` e `reconhecer_longo(reconhecedor, amostras, progresso)`. Testes: sinal sintético com silêncios em posições conhecidas (corte cai no bloco mais quieto em ±5 s); soma das janelas = áudio; tempos = deslocamento + local; sem repetição na emenda; arquivo < 60 s; vazio; reconhecedor falso que devolve tokens fixos por janela. Depende de: etapa 1.

**Etapa 3 — catálogo, hash e créditos (0,75 d).** Commit: `feat(modelos): Parakeet TDT 0.6B v3 int8 no catálogo, com revisão fixa, hash e créditos CC-BY-4.0`. Conteúdo: seção 6 inteira, `CREDITOS_TERCEIROS.md`, tela. Testes: entrada válida; `baixado` com 4 arquivos falsos num cache temporário; `exigir` diz "670 MB" e "Modelos locais"; hash divergente apaga e falha; `estado()` traz `licenca`; modelos antigos seguem válidos. Depende de: nenhuma (pode ir em paralelo às etapas 1 e 2).

**Etapa 4 — motor e worker (1 d).** Commit: `feat(transcricao): motor nvidia_parakeet em processo separado (sherpa-onnx)`. Conteúdo: `sherpa_worker.py` e `motores.py` (seção 7). Avisos: sem diarização própria (já sai de `resolver_motores`), "não informa confiança" se `ys_log_probs` vier vazio, entidades só na AssemblyAI, idioma fora da lista. Testes: ligado sem diarização própria; idioma fora da lista vira AssemblyAI + aviso; converte a saída do worker (`monkeypatch` em `_rodar_worker_sherpa`, como `tests/test_motores_asr.py:289-296`); sem modelo → `ErroASR` "não está baixado"; sem pacote → "falta instalar sherpa_onnx"; laço no motor falso gera aviso de alucinação; teste real com `skipif(não baixado)`. Depende de: etapas 1, 2, 3.

**Etapa 5 — Configurações (0,25 d).** Commit: `feat(config): Parakeet como opção do motor de transcrição`. Conteúdo: enum + rótulo "NVIDIA Parakeet TDT 0.6B v3 (local, CPU; não separa falantes)" e ajuda sem a promessa falsa (F3). Testes: `test_toda_opcao_da_lista_tem_rotulo` e `test_opcoes_sem_codigo_estao_marcadas_em_teste` já cobrem; novo teste de que o texto da ajuda não promete queda. Depende de: etapa 4.

**Etapa 6 — comparação (1 d).** Commit: `feat(avaliacao): asr_comparar mede S/D/I, erro de tempo, silêncio e RTF`. Conteúdo: seção 4.7; conferir antes o `--gabarito` do chat 06. Testes: `tests/test_asr_comparar.py` (S/D/I em casos pequenos; alinhamento por LCS; mediana e p90). Depende de: etapa 4.

**Etapa 7 — medição e decisão (0,5 d + sua máquina).** Commit: `docs(transcricao): medição do Parakeet na CPU do Fernando e decisão do gate`. Conteúdo: tabela M1-M14 preenchida em `docs/MEDICAO_PARAKEET.md`; decisão sobre "local recomendado", Canary como reserva e etapas 8 e 9. Depende de: etapa 6, gabaritos do chat 06 (item 5).

**Etapa 8 (opcional) — fala perdida (0,75 d).** Commit: `feat(transcricao): refaz trechos de fala perdidos no Parakeet`. Só se M6 reprovar (D > 3 %). Primeiro testar `blank_penalty`; depois portar `droppedSpeechGaps`/`spliceGap` (`parakeet.ts:157-240`, `sherpaWorker.ts:54-85`). Testes: casos do `parakeet.test.ts` portados; sinal com bloco alto sem tokens.

**Etapa 9 (opcional) — diarização sherpa (2 d).** Commit: `feat(diarizacao): diarização local por sherpa-onnx (segmentação pyannote 3.0 ONNX + embeddings)`. Só depois do gate e se você quiser aposentar o `.venv-nemo`. Conteúdo: 4.5; dois modelos no catálogo; `_baixar_url` com hash para o GitHub; opção em `diarization.engine`; DER no script. Testes: segmentos falsos → `atribuir_falantes`; 1 falante; limiar.

Total do núcleo (0 a 7): 0,25 + 0,75 + 1 + 0,75 + 1 + 0,25 + 1 + 0,5 = **5,5 dias**.

## 9. Testes e medições

**Automáticos (pytest, sem rede e sem modelo; motores falsos)**

| Teste | Arquivo | Verifica |
|---|---|---|
| prefixo `▁` e espaço dão as mesmas palavras | `test_sherpa_palavras` | 4.3 |
| pontuação isolada cola; número, hífen, vazio | idem | 4.3 |
| duração ausente → fim = próximo início, teto 0,32 s | idem | ajuste 2 |
| corte no bloco mais quieto; soma das janelas; sem duplicata | idem | 4.2 |
| `resolver_motores("nvidia_parakeet", …)` ligado; sem diarização própria; idioma fora da lista → AssemblyAI | `test_motores_asr` | I3, I4 |
| saída do worker vira palavras de 5 campos; `confidence` real ou 1.0 + aviso | idem | I1 |
| sem modelo / sem pacote → `ErroASR` com instrução | idem | I2, I5 |
| laço no motor falso → aviso de alucinação | idem | `motores.py:526-528` |
| entrada do catálogo válida; hash divergente falha; `estado()` com licença | `test_modelos_locais` | seção 6 |
| `wer_detalhado` S/D/I; alinhamento; p90 | `test_asr_comparar` | 4.7 |
| teste real (`skipif` sem modelo): clipe curto devolve ≥ 1 palavra, tempos crescentes, nenhum fim < início | `test_motores_asr` | integração |

**Medições na sua máquina (i7-10700)** — o gate usa M1, M5, M6, M10 e M13; M8/M9 decidem se serve para corte por palavra.

| # | Métrica | Como | Alvo para aprovar | Comparar com |
|---|---|---|---|---|
| M1 | RTF, 8 threads (3 min e 30 min) | `--tempo` | ≤ 0,25 (esperado 0,05-0,15) | Whisper turbo 0,4; Canary 1,5 |
| M2 | RTF, 4 threads | idem | registrar | HF usa 4 |
| M3 | carga do modelo | `carga_s` do worker | ≤ 6 s | Canary ~25 s |
| M4 | pico de memória do worker | Gerenciador de Tarefas ou `psutil` | ≤ 2,5 GB | cartão: ≥ 2 GB |
| M5 | WER contra o seu gabarito (limpo, barulhento, sobreposto), sem pontuação e caixa | `--gabarito` | em cada clipe ≤ WER do Whisper turbo + 1 ponto; média ≤ 1,25× a da AssemblyAI | cartão: pt 4,76 / 7,50 / 3,96 % em fala lida |
| M6 | deleções (D) | S/D/I | D ≤ 3 % das palavras do gabarito | — |
| M7 | WER contra a AssemblyAI | `--referencia` | só informativo (dizer na tabela se é erro ou concordância, F5) | README:61-62 |
| M8 | erro do início da palavra | LCS contra a AssemblyAI | mediana ≤ 0,10 s; p90 ≤ 0,30 s | grade de 80 ms |
| M9 | corte à mão | 30 palavras por clipe, ouvir em `start_time` e `end_time` | ≥ 27 de 30 sem comer sílaba | — |
| M10 | silêncio e ruído | 5 trechos de 60 s sem fala (room tone, música, vento) | ≤ 2 palavras/min e 0 laços | Whisper turbo e Canary no mesmo trecho |
| M11 | emendas | 10 min com janelas de 60 s × 20 s | diferença ≤ 1 ponto de WER; 0 duplicatas; ≤ 1 palavra partida a cada 10 emendas | — |
| M12 | idioma | 20 trechos pt-BR de < 10 s | 0 saídas em outra língua | — |
| M13 | estabilidade | 50 clipes em lote | 0 quedas do worker | `sherpa.ts:382` |
| M14 | ruído | clipes com 0 a 10 dB de SNR | WER ≤ 1,5× o do clipe limpo | cartão (inglês): +12 % a 10 dB, +84 % a 0 dB |

## 10. Critérios de aceite

1. `pytest tests/test_sherpa_palavras.py tests/test_motores_asr.py tests/test_modelos_locais.py tests/test_asr_comparar.py` passa sem rede, sem modelo e sem `sherpa_onnx`.
2. Com `sherpa_onnx` e o modelo, um clipe de 3 min em pt devolve palavras com 5 campos, tempos crescentes e pontuação.
3. Nenhum modelo baixa sozinho; sem o modelo o erro diz "670 MB" e "Configurações > Modelos locais".
4. A linha do modelo na tela mostra licença e créditos CC-BY-4.0; `CREDITOS_TERCEIROS.md` existe.
5. Download confere tamanho e sha256 na revisão fixada; arquivo truncado é recusado.
6. Queda do worker não derruba o servidor; o vídeo vai para `error` com mensagem útil.
7. O padrão global continua AssemblyAI; Parakeet aparece como opção sem "em teste".
8. `docs/MEDICAO_PARAKEET.md` traz M1 a M14 com números da sua máquina e a decisão do gate.
9. Nada mudou em `venv_nemo_worker.py`, no schema e nos motores existentes (`git diff --stat` mostra só os arquivos da seção 7).

## 11. Riscos e mitigação

| Risco | Prob. | Impacto | Mitigação | Métrica |
|---|---|---|---|---|
| Treino em português **europeu**, fala brasileira espontânea | média | alto | gate no gabarito BR; manter Whisper turbo e AssemblyAI; sem virar padrão | M5, M12 |
| Fala perdida (deleção) em janelas de 60 s | média | alto (texto some da busca) | `blank_penalty`, depois remendo do HF (etapa 8) | M6 |
| Grade de 80 ms nos tempos | alta | médio (corte comendo sílaba) | M8/M9; refinamento por energia ±80 ms no futuro; AssemblyAI para corte fino | M8, M9 |
| Idioma não forçável (pt × es × it em trecho curto) | baixa-média | médio | `IDIOMAS_PARAKEET`, aviso por palavras funcionais, queda para AssemblyAI | M12 |
| Aborto do onnxruntime ou conflito de DLL no Windows | baixa-média | alto se no servidor | subprocesso (D1); lote de 50 | M13 |
| `sherpa-onnx` 2.0.1 (um dia de idade) quebra o denoise | média | médio | pin `<2`; rodar `tests/test_audio_denoise.py` ao mudar a versão | — |
| Licenças: CC-BY-4.0 do modelo (crédito + aviso de modificação); Apache-2.0 do HF e do sherpa (cabeçalho + NOTICE; compatível com GPLv3 no sentido Apache → GPL); Reverb é **non-commercial** (não usar); pyannote com termos no HF; licença dos embeddings não conferida | baixa | médio | `CREDITOS_TERCEIROS.md`; revisar licença do embedding antes da etapa 9 | critério 4 |
| Desempenho pior que o estimado (CPU dividida com servidor, Qdrant e Laya) | média | baixo | worker em lote já isolado; 4 threads se preciso | M1, M2 |
| Fala sobreposta (um canal só) | média | médio | já ocorre nos outros motores; aviso; diarização não resolve | M5 (clipe sobreposto) |
| Nomes próprios, números e siglas do bastidor | alta | baixo-médio | entidades e glossário seguem só na AssemblyAI (`motores.py:332-333`); medir | M5 |
| Arquivo do modelo truncado ou trocado | baixa | alto | revisão fixa + sha256 + tamanho em `baixado` | critério 5 |

## 12. Perguntas para o Fernando (com recomendação)

1. **`sherpa-onnx` entra no `requirements.txt`?** Recomendo sim: wheel de ~2 MB e precedente do faster-whisper (`requirements.txt:11-12`). Alternativa: criar `requirements-opcional.txt`, que `modelos_locais.py:224` já cita e não existe.
2. **Posso atualizar o sherpa-onnx de 1.13.6 para 1.13.8** se a sonda mostrar que a 1.13.6 não devolve `durations`? Recomendo sim, rodando depois `tests/test_audio_denoise.py` e um denoise real; **não** ir para a 2.x agora.
3. **Você roda a sonda (etapa 0) com um clipe seu de 20 a 30 s e baixa os 670 MB?** Recomendo a sonda antes de qualquer código; o download pode ser à mão (`huggingface-cli`) ou pela tela depois da etapa 3.
4. **Quais clipes entram no gabarito** (limpo, barulhento, sobreposto) e algum com sotaque regional forte? Recomendo os do chat 06 (item 5) mais um de sotaque forte.
5. **Se passar o gate, Parakeet vira "local recomendado" com a AssemblyAI seguindo como padrão?** Recomendo sim.
6. **Marcar o Canary como "reserva" na tela?** Recomendo só o texto agora; apagar os 6 GB só com sua ordem.
7. **Etapas 8 e 9:** a 8 só se D > 3 %; a 9 só se você quiser aposentar o `.venv-nemo`, o que exige largar Canary e SenseVoice (este não serve para português).
8. **Registrar o motor usado em cada vídeo** (coluna `asr_engine`)? Recomendo sim, em frente própria por mexer no schema.
9. **Modelo local ausente:** erro com instrução (como hoje) ou cair na AssemblyAI (o que o texto da ajuda promete e custa dinheiro)? Recomendo erro e corrigir o texto.
10. **Redação do crédito CC-BY** na linha do modelo e em `CREDITOS_TERCEIROS.md` (seção 6): aprova? Recomendo sim.

## 13. Prompt para o chat de implementação

> No chat vai tudo abaixo da linha `---`. Ele manda ler este plano (`docs/plano_hyperframes/E_parakeet.md`).

```markdown
# Chat 09: transcrição local com Parakeet TDT 0.6B v3 (sherpa-onnx)

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> Não depende dos chats 01 a 05. A etapa 7 usa os gabaritos do chat 06 (item 5).

---

Quero um motor local de transcrição no CapIAu Talho com o Parakeet TDT 0.6B v3 (int8) rodando no
sherpa-onnx, no `.venv` principal, sem PyTorch, em português, com tempo por palavra. Leia antes o
plano da frente E (`docs/plano_hyperframes/E_parakeet.md`, seções 4, 5, 8 e 9) e confira no código cada
afirmação; linhas podem ter andado.

## O que já existe (conferido em 28/10/2026)

- Contrato e motores: `src/transcription/motores.py` (`ResultadoASR` 79-85, `resolver_motores` 88-129,
  `_rodar_worker_nemo` 365-392, `MOTORES` 510-516, `transcrever` 519-533, `repeticao_em_loop` 465-481).
- Catálogo: `src/services/modelos_locais.py` (`ModeloLocal` 29-43, `exigir` 218-229, `baixar` 275-305);
  tela `src/ui/js/modelosLocais.js`; rota `src/api/routes/modelos.py`.
- Configurações: `src/services/settings_registry.py:159-212`. Teste de consistência:
  `tests/test_motores_asr.py:35-39`.
- sherpa-onnx já é usado no denoise (`src/media/audio_denoise.py`, import preguiçoso, versão 1.13.6
  citada), mas não está no `requirements.txt`.
- O Whisper local já devolve tempo por palavra; o ganho do Parakeet é velocidade, estabilidade e texto pronto.
- Modelo: `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`, revisão
  `2bda32ec70b097a55adaa07d9a7173915b43cc78`, 4 arquivos, 670 MB, CC-BY-4.0, treino de português europeu.
- Porte de referência (só leitura, Apache-2.0): HyperFrames, `packages/cli/src/whisper/` (`parakeet.ts`,
  `sherpaWorker.ts`, `sherpa.ts`). Se não estiver em disco, peça a pasta; o plano descreve os algoritmos.

## O que fazer (um commit por etapa; conventional commits em português)

0. `chore(transcricao): sonda do sherpa-onnx e do Parakeet`: `scripts/sherpa_sonda.py` + dependência. **Pare e me peça para rodar.**
1. `feat(transcricao): junta tokens do Parakeet em palavras`: `src/transcription/sherpa_palavras.py` + testes.
2. `feat(transcricao): janelas de 60 s cortadas no silêncio`: sem sobreposição, testes com sinal sintético.
3. `feat(modelos): Parakeet no catálogo com hash e créditos CC-BY-4.0`: campos novos, tela, `CREDITOS_TERCEIROS.md`.
4. `feat(transcricao): motor nvidia_parakeet em processo separado`: `sherpa_worker.py`, `motores.py`, testes com motor falso.
5. `feat(config): Parakeet como opção do motor de transcrição`: enum, rótulo, ajuda sem a promessa falsa.
6. `feat(avaliacao): asr_comparar mede S/D/I, erro de tempo, silêncio e RTF`.
7. `docs(transcricao): medição do Parakeet e decisão do gate`: comigo, na minha máquina.
8. e 9. só se eu mandar (fala perdida; diarização sherpa).

## O que perguntar antes de começar

`sherpa-onnx` no `requirements.txt` ou `requirements-opcional.txt`; atualizar 1.13.6 → 1.13.8 se a
sonda pedir; quais clipes do gabarito; modelo ausente: erro (recomendado) ou cair na AssemblyAI;
texto do crédito CC-BY; etapas 8 e 9.

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev` e `docs/HANDOFF_DESIGN_UI.md`.
- Outra sessão mexe na interface (`index.html`, `main.js`, `workspaceManager.js`, `styles.css`,
  `library.js`, `welcomeHub.js`, `player.js` às vezes). Commit só dos seus trechos (índice montado a
  partir do HEAD), direto na main, sem coautoria, sem push.
- Modelos não baixam sozinhos (`src/services/modelos_locais.py`, `exigir`). Não baixe os 670 MB, não
  instale pacotes e não mexa no `.venv-nemo` sem me perguntar.
- Import de `sherpa_onnx` só dentro de funções; os testes rodam sem o pacote e sem o modelo.
- Scripts de edição em arquivo, com `PYTHONUTF8=1`. Servidor de teste `capiau-server-venv` (8022).
- Português, direto. Verifique antes de afirmar; marque o que for estimativa.

## Pronto quando

Com o modelo baixado, um clipe meu em português sai com palavras, tempos e pontuação; sem o modelo, a
mensagem diz o que baixar; os testes passam sem rede; a tela mostra os créditos CC-BY-4.0; o padrão
continua AssemblyAI; e `docs/MEDICAO_PARAKEET.md` mostra RTF, WER contra o meu gabarito, deleções,
erro de tempo e silêncio, com a decisão do gate.
```
