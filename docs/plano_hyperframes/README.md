# Plano mestre: o que o CapIAu-Talho aproveita do HyperFrames

> Escrito em 28/10/2026 a partir de `docs/PESQUISA_HYPERFRAMES.md` e de uma análise frente por frente do código dos
> dois repositórios: Talho no commit `9cba1b2`, HyperFrames v0.8.185 (Apache-2.0), lido e nunca executado.
> São nove frentes; cada uma tem um plano detalhado nesta pasta, com o prompt pronto para o chat de implementação na
> seção 13. Nada aqui foi implementado: é análise e plano.

---

## Como usar esta pasta

1. Leia este arquivo inteiro uma vez. As seções 3 (defeitos encontrados) e 9 (decisões) pedem respostas suas.
2. Escolha a próxima frente pela seção 4 (marcos e ordem).
3. Abra o plano da frente e cole a seção 13 dele num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
4. Todo plano segue o mesmo roteiro: objetivo, estado atual com `arquivo:linha`, o que o HyperFrames tem, viabilidade,
   decisões, modelo de dados, arquivos, etapas (um commit cada), testes, aceite, riscos, perguntas, prompt.

**Marcas usadas nos planos:** **[lido]** conferido no código; **[inferência]** dedução; **[a medir]** precisa de teste;
**[medido]** número obtido durante a análise; **[web]** fonte externa.

**Atenção aos números [medido].** Foram tirados no contêiner Linux da análise (Xeon 2,1 GHz, Chromium 141 do Playwright,
FFmpeg 6.1.1), não no seu Windows (i7-10700, Edge/Chrome, FFmpeg 7.1.4 Jellyfin). Todo número que decide algo aparece
de novo como [a medir], e cada plano diz o comando para medir na sua máquina (resumo na seção 8).

"Rascunho fora do repositório" nos planos são os experimentos e downloads feitos durante a análise; não foram versionados.

---

## 1. Resumo

1. **A análise achou defeitos reais no Talho antes de trazer qualquer coisa do HyperFrames.** O export sai um quadro
   mais curto; o HD sai sem etiqueta de cor e com matriz BT.601 (29,5 dB de erro lido como Rec.709); o compressor do
   arquivo fica de 0,6 a 19 dB abaixo do que a tela toca; o EQ erra até 2 dB; áudio mono perde 3 dB; o reverso difere um
   quadro da tela; o OTIO não leva nem a velocidade constante do clipe. A lista completa está na seção 3.
2. **Fundação primeiro.** Duas frentes não entregam nada visível, mas tornam as outras seguras: **B** (testes que olham a
   imagem e o som do arquivo, e depois comparam com o Program) e **D1** (um navegador headless comum, com origem segura,
   cancelamento e limpeza de processos). Quase todas as outras dependem de uma delas.
3. **Maior valor visível:** **C** (legendas da montagem a partir da transcrição; hoje não existem), **A** (o áudio do
   arquivo igual ao da tela, por construção, nos clipes com gate e compressor) e **G1** (o export HD com a cor certa).
4. **Barato e útil cedo:** **F0–F3** (volume animável com curva sobre a forma de onda, 7 dias, sem depender de ninguém)
   e **H E1–E4** (revisão grátis da montagem: flash, buraco, repetição, título curto, área segura; 7 dias).
5. **Maior frente:** **D2** (composições animadas: GCs ligados à biometria, cartelas, gráficos, mapa com rota). O
   HyperFrames é Apache-2.0 e pode ser portado, mas as animações do catálogo usam GSAP, que não é software livre: as 14
   escolhidas serão reescritas em CSS/WAAPI.
6. **Transcrição local mais rápida (E):** Parakeet TDT 0.6B v3 no sherpa-onnx, sem PyTorch. Entra como opção, não como
   padrão, até passar no seu gabarito: o português do treino é europeu.
7. **Tamanho:** o núcleo das nove frentes soma ≈ 84 dias úteis; tudo o que os planos descrevem, opcionais inclusive,
   ≈ 170 (estimativas grossas). Por isso a seção 4 divide em quatro marcos, e o primeiro cabe em ≈ 3 semanas.

---

## 2. As frentes

| Frente | Entrega | Núcleo | Tudo | Depende de | Plano |
|---|---|---:|---:|---|---|
| **B** Regressão do render | Nível 1: imagem e som do arquivo contra oráculos e referências aprovadas (≈ 1,5 MB no Git). Nível 2: quadro do Program × quadro do export | 8,5 d (corte mínimo 5) | 15,5 d | nada (o áudio do Nível 2 espera a A) | [B_regressao_render.md](B_regressao_render.md) |
| **D1** Navegador comum | `src/navegador/`: servidor em `127.0.0.1` (origem segura), `Navegador`/`Pagina`, captura com alfa, cancelamento, órfãos, diagnóstico; títulos migrados sem mudar um pixel; Chrome Headless Shell opcional; BeginFrame só se o spike provar ganho | 9 d | 12 d | nada | [D1_navegador.md](D1_navegador.md) |
| **A** Áudio igual à tela | Clipes com gate ou compressor saem do mesmo grafo WebAudio do player (`OfflineAudioContext`); EQ e mono corrigidos no FFmpeg; null tests | 11,5 d | 13,5 d | D1 etapas 1–2 (as etapas 0 e 1 da A não dependem) | [A_audio_paridade.md](A_audio_paridade.md) |
| **C** Legendas | "Gerar legendas da sequência": clássica (42×2, 17 cps) e dinâmica com karaokê; projeção de corte, velocidade e J/L-cut; filtro de alucinação; SRT/VTT/ASS pelo backend | 9,5 d (sem karaokê) | 16,5 d | nada até E6; E7 espera D1, E9 espera B | [C_legendas.md](C_legendas.md) |
| **D2** Composições HTML | Clipe de texto com bloco `composicao`: página HTML seekável com variáveis, iframe no Program, foto no export; 14 composições portadas (5 GCs, cartelas, contador, gráficos, mapa, antes/depois, HUD) | 18 d (E0–E6) | 34 d (com HTML do usuário) | D1 etapas 1–4 (só o render); B para os casos | [D2_composicoes_html.md](D2_composicoes_html.md) |
| **E** Parakeet | Motor local `nvidia_parakeet` (sherpa-onnx, subprocesso, 670 MB), tempo por palavra, catálogo com crédito CC-BY, gate de qualidade | 5,5 d | 8,25 d (com diarização sherpa) | nada; gabaritos do chat 06 para o gate | [E_parakeet.md](E_parakeet.md) |
| **F** Automação de áudio e rampas | Faixas por clipe em `clip.keyframes.volume`/`.rate` com amostragem única em JS e Python; volume desenhado e editável sobre a onda; ducking pelas palavras da transcrição; nivelador; batidas com snap; rampa de velocidade no player, no render e no OTIO (em degraus) | 7 d (volume, F0–F3) | 20 d (+4–6 opcionais) | nada até F7; F8 espera B; ganho acima de 0 dB espera A | [F_audio_avancado_rampas.md](F_audio_avancado_rampas.md) |
| **G** Cor | Export HD com matriz e etiqueta bt709 (composição em RGB até uma conversão final); HDR→SDR e LUT técnica log→709 assadas no proxy e repetidas no master pela mesma função; sondagem de filtros do FFmpeg; sugestão de correção; curvas (SVG ao vivo e `lut1d`); LUT criativa por WebGL2 só se o spike passar | 8 d (G0–G2c) | 25 d | B (cenários `cor_hd_matriz`, `cor_lut_cube`); `zscale` no seu FFmpeg [a medir] | [G_cor.md](G_cor.md) |
| **H** Revisão pelo agente | `src/revisao/`: checagens grátis da montagem, tiras de 5 quadros por corte com medidas de pixel e contraste, revisão visual por mosaicos (Gemini 2.5 Flash, só sob clique), ferramenta `revisar_cortes`, painel, selo nos ghost clips, seção "Revisão" no export que nunca bloqueia | 7 d (E1–E4) | 19 d | nada até E8; E9 espera D1 | [H_revisao_agente.md](H_revisao_agente.md) |

Estimativas em dias úteis, grossas, sem as correções de defeitos (cada uma é um commit próprio).

---

## 3. Defeitos que a análise encontrou

Nenhum destes depende do HyperFrames. A maioria vira primeiro um teste da frente B (em `xfail(strict)`, que quebra quando
o defeito for corrigido) e depois um `fix(...)` próprio, com o seu aval.

| # | Defeito | Evidência | Situação | Quem testa e corrige |
|---|---|---|---|---|
| 1 | **O export sai 1 quadro mais curto** (95 em vez de 96 quadros em 4 s a 24 fps) | o `fps=N` final (`comando.py:717`) depois do `overlay` perde o último quadro | [medido] no FFmpeg 6.1.1; [a medir] no 7.1.4 com `ffprobe -count_frames` (B §2.6) | B cenário 2 → `fix(render)` |
| 2 | **HD sem etiqueta de cor e com matriz BT.601** | `ffprobe` do export: `color_space=unknown`; nenhum `out_color_matrix`/`-colorspace` em `src/export/video_render/`; o proxy também não é etiquetado | [medido]: 29,5 dB contra o ideal lido como Rec.709; remendo no fim 38,6 dB; composição em RGB até o fim 46,6 dB | B cenário 6; G etapas G1a–G1b |
| 3 | **Compressor do arquivo 0,6 a 19 dB abaixo da tela**, conforme o nível | o `DynamicsCompressorNode` tem joelho de 30 dB e ganho automático; o `acompressor` não reproduz | [medido]; o banner fala em "2,06 dB", subestimado | A (por construção) |
| 4 | **EQ erra até 2 dB** | o `Q` do `highpass` do WebAudio é em dB, o FFmpeg recebe `width=1` linear (`grafo_audio.py:407`); shelves com largura diferente | [medido]; com o `Q` corrigido o resíduo cai a −93,6 dBFS RMS | A etapa 0 (1 d, sem navegador) |
| 5 | **Áudio mono sai 3 dB mais baixo** no export | a tela toca mono sem perda | [medido] | A etapa 0 |
| 6 | **Reverso difere 1 quadro** entre export e player | o export começa no quadro `out − 1`; a fórmula do player (`player.js:4033`) no quadro do instante `out` | export [medido], player [inferência] | B cenário 3; decisão sua (seção 9) |
| 7 | **A curva "bezier" não existe** e vira linear no player e no render | `CURVAS_CONHECIDAS` (`fade.py:40`) não a lista; o próprio teste canônico a usa | [lido] | B cenário 1; decidir: implementar ou trocar por `s_curve` |
| 8 | **Com três pistas de vídeo ocupadas, o Program não mostra a do meio**; o export empilha todas | o Program compõe só base + sobreposição (`player.js:3646-3694`) | [lido]; efeito [inferência] | B Nível 2 → `fix(player)` |
| 9 | **SRT e VTT não passam pelo backend** | a rota recusa o formato (`narrative.py:529-530`); o SRT/VTT sai de uma cópia em JS (`panels.js:2528`); `subtitles_export.py` não tem chamador | [lido] | C etapa E5 |
| 10 | **O export OTIO/XML/EDL não leva a velocidade do clipe**, nem a constante | nenhum `TimeWarp` em `otio_export.py` | [lido] | F etapa F8 (velocidade constante pode vir antes, num `fix(export)`) |
| 11 | **Cancelar o render não fecha o Chromium** dos títulos; a thread da fila é daemon e pode deixar processo órfão | `execucao.py:76-124` mata só o ffmpeg; `execucao.py:143-145` | [lido] | D1 etapas 2–3 |
| 12 | **O preflight não percebe "Playwright instalado, mas sem Edge/Chrome"**; o título some só na hora do render | `fidelidade.py:215-224` só olha `find_spec("playwright")` | [lido] | D1 etapa 3 |
| 13 | **A ajuda do motor de transcrição promete cair na AssemblyAI** quando o modelo local falta, mas o código dá erro | texto em `settings_registry.py:170` | [lido] | E etapa 5 (corrigir o texto) |
| 14 | **Instrução de instalação aponta para arquivo inexistente** e `sherpa-onnx` (usado no denoise) não está no `requirements.txt` | `modelos_locais.py:224` cita `requirements-opcional.txt`; `requirements.txt` | [lido] | E etapa 0 |
| 15 | **CORS `*` com credenciais** na API local: qualquer site aberto no navegador pode chamar `http://127.0.0.1:<porta>/api/...` e ler a resposta | `src/api/server.py:66-72` | [lido]; o alcance real depende de como o app é servido [a medir] | fora das frentes: restringir `allow_origins` à origem do próprio app (D2 também depende disso) |
| 16 | **Desfoque de clipe e de título com raios diferentes** para o mesmo `blur(Npx)` do CSS | clipe: `gblur=sigma=N` (`cor.py:229`); título: `1,05·N` com `steps=4` (`titulos.py:65`) | [lido]; efeito na imagem [inferência] | B cenário 9 (Nível 2) |
| 17 | **A wiki promete recursos de cor que não existem** (rodas lift/gamma/gain, temperatura/matiz, LUT 3D) | `wiki/11.-Cor-Grading-e-Transformacoes-Visuais.md` contra o código | [lido] | G, no último commit |

Os itens 1, 4, 5, 7, 13 e 14 são pequenos e podem entrar já no primeiro marco.

---

## 4. Ordem recomendada

### 4.1 Dependências

- **B** e **D1** não dependem de ninguém.
- **A** etapas 0–1 não dependem; etapa 2 em diante precisa de **D1** etapas 1–2.
- **C** etapas E0–E6 não dependem; E7 (camada contínua) precisa de **D1** etapa 3; E9 precisa de **B**.
- **D2** etapas E0–E2 e E4 não dependem; E3 (render) precisa de **D1** etapas 1–4.
- **E** não depende de nenhuma frente; o gate de qualidade precisa dos gabaritos do chat 06.
- **F** F0–F7 não dependem; F8 (rampa no render) precisa de **B**; ganho acima de 0 dB precisa de **A**.
- **G** G0 não depende; G1a em diante precisa de **B** (cenário `cor_hd_matriz`) e da medição G0.
- **H** E1–E8 não dependem; E9 (caixa real do título) precisa de **D1** etapas 1–4; B e C só fornecem dados de teste.

### 4.2 Quatro marcos

| Marco | O que entra | Dias (≈) | Você ganha |
|---|---|---:|---|
| **1. Fundação e correções** | B etapas 1–5 (corte mínimo, com o cenário canônico aprovado); D1 etapas 0–3 (spike, servidor, lançador, títulos migrados); A etapa 0 (EQ e mono); defeitos 1, 7, 13 e 14; E etapa 0 (sonda); G etapa G0 (medição de cor) | 14 | testes que veem o arquivo; render que não deixa Chromium vivo; EQ e mono certos |
| **2. O que se vê e se ouve** | C E0–E6 (legendas clássica e dinâmica, SRT/VTT/ASS); A etapas 1–5 e 7 (áudio pela página, medida no Windows); G G1a–G1b (cor HD certa); E etapas 1–7 (Parakeet com gate); D1 etapas 4–6 e 8; B etapas 6–8 | 37 | legendas da montagem; áudio do arquivo igual à tela; HD com a cor certa; transcrição local rápida |
| **3. Ofício barato** | F F0–F5 (volume animável, ducking, nivelador); H E0–E4 (revisão grátis, painel, seção no export); G G2a–G3b (sondagem de filtros, HDR→SDR, LUT técnica no proxy) | 26 | mixagem com curva e ducking; revisão automática da montagem; celular HDR e câmera log certos |
| **4. Motion graphics e o resto** | D2 E0–E11; B Nível 2 (etapas 9–13); G G4–G6c (sugestão de correção, curvas, LUT criativa); F F6–F8 (batidas, rampas); H E5–E8 (tiras, contraste, visão, CLIP); opcionais dos planos | 69 + opcionais | GCs e gráficos animados; paridade player × export medida; curvas e LUT; rampas; revisão visual |

D2 está no último marco por ser a maior frente e por o Titler já ter presets de GC; se GCs animados forem prioridade,
D2 E0–E6 (18 dias) pode subir para o marco 3, porque só depende da D1 etapas 1–4, prontas no marco 2.

### 4.3 Chats em paralelo sem pisar um no outro

Arquivos "quentes" que mais de uma frente altera:

| Arquivo | Frentes | Regra |
|---|---|---|
| `src/ui/js/player.js` | A (etapa 1, bloco de áudio), D2 (E4, camada de composições), F (fator de volume, rampa), G (filtro SVG de curvas), B (só correções) | regiões diferentes; nunca dois chats no mesmo bloco; canônico Node a cada commit |
| `src/export/video_render/titulos.py` | D1 (etapa 3), C (E3, E6, E7), D2 (E3) | **D1 etapa 3 primeiro**; depois C e D2 em sequência |
| `src/export/video_render/grafo_video.py` | G (composição em RGB: 7 `overlay=`), F (rampa por `setpts`), B (correções) | G1a antes de F8 |
| `src/export/video_render/grafo_audio.py` | A, F | A antes de F1 se as duas estiverem em andamento (F reaproveita o estágio de entrada) |
| `src/export/video_render/comando.py` | A (etapa 3), B (correções), G (etiqueta e conversão final; fontes antes do grafo) | sequencial |
| `src/export/video_render/fidelidade.py` | A, D1, D2, F, G, H | avisos novos em blocos separados; um commit por frente |
| `src/export/video_render/modelo.py` | D2, F, G | só campos novos e entradas em `EFEITOS_POR_CATEGORIA` |
| `src/export/otio_export.py`, `src/export/subtitles_export.py` | C, D2, F, G | C primeiro (reescreve `subtitles_export.py`); D2 só filtra `composicao` |
| `src/media/ffmpeg.py`, `src/services/ingest.py` | G (proxies com transformação de entrada e etiqueta; sondagem de filtros), F (sondagem de filtros) | uma sondagem só, criada pela primeira que chegar |
| `src/services/settings_registry.py`, `src/services/modelos_locais.py`, `src/ui/js/modelosLocais.js` | D1, E, C, A, H | entradas novas no fim das listas; conflitos triviais |
| `src/api/server.py` | D1 (`lifespan`), D2 (montagem de `/composicoes/` com CSP) | sequencial |
| `src/ui/js/timelineState.js`, `timelineRenderer.js`, `timelineInteraction.js` | C, D2, F, H | regiões diferentes; F propõe módulo novo `timelineFaixa.js`; atenção ao desfazer (C mediu o custo com milhares de clipes) |
| `src/ui/js/exportVideo.js` | A e D1 (avisos), H (seção "Revisão") | sequencial |
| `src/services/chat_agent.py` | H | outra sessão pode estar no agente; commit só dos seus trechos |

No marco 1 dá para rodar em paralelo: **B** (só `tests/`), **D1** etapas 0–2 (só `src/navegador/`) e **A** etapa 0
(só `grafo_audio.py`). No marco 2: **C** E0–E2 (módulos novos), **E** (transcrição) e **A** etapas 1–2.
No marco 3: **F** F0–F2, **H** E1–E2 e **G** G2a.

---

## 5. Contrato de dados comum

O `sequence_json` continua na **versão 2**. Todas as frentes só **acrescentam** campos; timelines antigas abrem iguais.
A gravação já leva o clipe inteiro (`timelinePersistencia.js`: "vai o clipe inteiro, menos o que é derivado"), então campos
novos persistem sem migração. O que exige cuidado está do lado do render: `modelo._clipe` só guarda o clipe cru (`bruto`)
para `type == "text"` (`modelo.py:478`), trata `type` desconhecido como vídeo e o preflight avisa efeito desconhecido.

| Frente | O que acrescenta | Onde |
|---|---|---|
| C | bloco `legenda` no clipe de texto (palavras, fonte, modo, marca `editada`); pista "Legendas" (`kind: "text"`) | `sequence_json` |
| D2 | bloco `composicao` no clipe de texto (`id`, versão, variáveis); a camada de texto e o export de legendas ignoram esses clipes | `sequence_json` |
| F | faixas `clip.keyframes.volume` e `clip.keyframes.rate` (tempo local ao clipe, `linear` e `hold`, até 256 pontos); metadados do ducking com assinatura da voz, para marcar "desatualizado" | `sequence_json` |
| G | transformação técnica de entrada por mídia (LUT, HDR→SDR, hash aplicado no proxy); biblioteca de LUTs do projeto; efeito `color` ganha curvas e temperatura/matiz; efeito de LUT criativa | banco (`video`), disco e `sequence_json` |
| H | `achados` nos ghost clips; última revisão guardada por hash da sequência; configurações `revisao.*` | resposta do agente, banco e Configurações |
| A | nada na timeline; configuração `render.audio_cadeia`; WAV temporários na pasta do render | Configurações |
| D1 | configurações `render.navegador_*`; Chrome Headless Shell no catálogo; `data/cache/navegador/` | Configurações e cache |
| E | opção `nvidia_parakeet` em `transcription.engine`; modelo no catálogo | Configurações |
| B | nada no app; cenários em `tests/render_regressao/cenarios/*.json` usam o mesmo `sequence_json` v2 | testes |

**Regras para todas as frentes**

1. Tipo de efeito novo entra em `modelo.EFEITOS_POR_CATEGORIA` no mesmo commit (é dali que sai a lista de efeitos
   conhecidos do preflight, `fidelidade.py:30`); senão o preflight acusa efeito desconhecido.
2. Semântica nova de clipe tem de dizer, no mesmo plano, o que acontece em: player, render, export OTIO/XML/EDL, export
   de legendas e preflight.
3. Metadados próprios no OTIO ficam em `metadata["capiau"][<campo>]` (C já usa `metadata.capiau.legenda`).
4. Desligar no escopo do render é escolha do editor e nunca vira aviso; limitação do motor vira aviso (a distinção que
   `fidelidade.py` já faz). A frente H acrescenta uma terceira categoria, "revisão", que nunca bloqueia o export.

---

## 6. Peças compartilhadas

- **`src/navegador/` (D1).** Única forma de falar com o navegador headless. Consumidores: títulos (já na etapa 3),
  A (`render_audio.html` e `PUT` do WAV), C (legendas queimadas pelos títulos), D2 (composições), H (caixa real do título),
  B Nível 2 (página do Program). Interface na seção 7.1 do plano D1.
- **`tests/render_regressao/` (B).** Toda frente que muda pixels ou amostras traz o seu cenário (`paridade_audio`,
  `legenda_*`, `clipe_html_*`, `cor_hd_matriz`, `cor_lut_cube`, `cor_curvas`, `hdr_sdr`, `audio_automacao_volume`,
  `velocidade_rampa`). Tabela na seção 6 do plano B.
- **Sondagem de filtros do FFmpeg (G etapa G2a).** Hoje o Talho só sonda encoders (`ffmpeg.py:243`). G e F precisam saber
  se há `zscale`, `lut1d`, `lut3d`, `rubberband`, `prores_ks`: uma sondagem só, cacheada, com aviso no preflight.
- **`CREDITOS_TERCEIROS.md` (raiz, novo).** Criado pela primeira frente que portar código ou vendorizar arquivo de
  terceiros. Cada arquivo portado leva no cabeçalho: origem (repositório e caminho), "Copyright 2026 HeyGen, Inc.",
  "Licensed under the Apache License, Version 2.0", "modificado para o CapIAu-Talho" e a data.
- **Catálogo de modelos locais.** D1 acrescenta o Chrome Headless Shell (120 MB); E acrescenta o Parakeet (670 MB) e,
  opcional, a diarização sherpa. Regra mantida: nada baixa sozinho.

---

## 7. Licenças

| Item | Licença | Como entra |
|---|---|---|
| Código do HyperFrames | Apache-2.0 ("Copyright 2026 HeyGen, Inc.") | Pode ser portado para o Talho (GPLv3), com cabeçalho e entrada em `CREDITOS_TERCEIROS.md` |
| GSAP (animações do catálogo) | "GSAP Standard License", não OSI | **Não entra.** As 14 composições da D2 são reescritas em CSS/WAAPI. O texto da licença não pôde ser lido em primeira mão nesta análise (`gsap.com` bloqueado na rede da sessão): confira antes de qualquer ideia de redistribuir |
| Parakeet TDT 0.6B v3 | CC-BY-4.0 | Download a pedido; crédito visível em Modelos locais e em `CREDITOS_TERCEIROS.md` |
| sherpa-onnx | Apache-2.0 | Dependência pip (já usada no denoise) |
| Chrome Headless Shell | build do Google | Download a pedido do site do Google; o Talho não redistribui |
| Fontes das composições (≈ 8 famílias) | OFL | Vendorizadas em `src/ui/composicoes/` com `LICENCAS.md` |
| d3-geo, topojson-client, world-atlas (mapa da D2) | ISC | Vendorizados na composição do mapa |
| LUTs de fabricante (V-Log, S-Log etc.) | dos fabricantes | O Talho não embarca; você importa as suas (G) |

---

## 8. O que só pode ser medido na sua máquina

| Quando | O quê | Plano |
|---|---|---|
| Antes da D1 etapa 7 | `scripts/spike_navegador.py`: BeginFrame no Windows, alfa, ganho real, sandbox, órfãos (≈ 30 min) | D1 etapa 0 |
| No começo da B | `ffprobe -count_frames` e `ffprobe ... color_space` num export real (defeitos 1 e 2) | B etapa 2 |
| Antes da G1 | `scripts/medir_cor.py` (≈ 2 min): com que matriz o Edge decodifica fonte sem etiqueta; se o seu FFmpeg tem `zscale`, `lut1d`, `lut3d` | G etapa G0 |
| Antes da A etapa 5 | `scripts/medir_paridade_audio.py` com Edge e Chrome (≈ 10 min) | A etapa 5 |
| Antes do motor da E | sonda do sherpa-onnx com um clipe seu de 20–30 s; baixar 670 MB | E etapa 0 |
| No começo da C | `scripts/legendas_medir.py`: tamanho do comando do FFmpeg, ms por foto, custo do desfazer | C etapa E0 |
| Antes da F2 e da F7 | script de 5 min: frequência de atualização do volume no player, taxa em que o Chromium muda o áudio, filtros do seu FFmpeg | F |
| Antes da H E7 | `scripts/revisao_medir.py`: tempo de 40 cortes; tokens e custo reais de 10 mosaicos; limiares em 3 projetos | H etapa E0 |
| Antes da D2 E1 | `scripts/spike_composicoes.py`: busca por WAAPI, chave de deduplicação, iframe no Program; o seu FFmpeg tem `prores_ks`? | D2 etapa E0 |

---

## 9. Decisões que preciso de você

As recomendações estão entre parênteses. As perguntas completas estão na seção 12 de cada plano.

**Antes de começar (marco 1)**

1. **B:** versionar no Git, sem LFS, as fontes sintéticas (≈ 150 KB) e as referências PNG (≈ 1 MB)? (sim)
2. **D1:** um servidor HTTP em `127.0.0.1`, porta aleatória e token, durante o render? Ele destrava o gate da A. (sim)
3. **D1:** rodar o spike da etapa 0 (≈ 30 min) antes de qualquer trabalho de BeginFrame? (sim)
4. **A:** o arquivo com compressor pode ficar mais alto que os masters antigos, igual ao que você ouve no Program? (sim)
5. **B:** reverso começa no quadro `out − 1` (como o export faz hoje, padrão de NLE; muda o player) ou no instante `out`? (`out − 1`)
6. **B:** a curva `bezier`: implementar de verdade ou tratar como `s_curve`? (decidir ao ver o cenário 1)

**No marco 2**

7. **C:** clássico (42 caracteres × 2 linhas, 17 cps como aviso) como padrão de documentário e dinâmico só para redes? (sim)
8. **C:** falas sobrepostas numa segunda pista "Legendas 2" agora, hífen depois? (sim)
9. **G:** export sempre `bt709`, com composição em RGB até uma conversão final? (sim; o remendo no fim só se a CPU não aguentar)
10. **E:** `sherpa-onnx` no `requirements.txt`, Parakeet como "local recomendado" só depois do gate, AssemblyAI segue padrão? (sim)
11. **E:** modelo local ausente dá erro com instrução (e o texto da ajuda é corrigido), em vez de cair na AssemblyAI? (sim)

**No marco 3**

12. **F:** volume com teto de 0 dB na v1 (ganho acima só depois da A); ducking começando em −12 dB, ataque de 0,15 s terminando no início da fala, soltura de 0,4 s? (sim, ajustando de ouvido)
13. **H:** a revisão visual só pelo seu clique (o agente não a dispara), teto de 30 cortes e US$ 0,10 por revisão? (sim)
14. **G:** celular HDR vira SDR sozinho, com chip desligável por mídia? Quais câmeras em log você usa, e tem as LUTs oficiais? (sim; começar por uma câmera)

**No marco 4**

15. **D2:** composição como clipe de texto com bloco `composicao`, não um tipo novo de clipe? (sim)
16. **D2:** texturas de arquivo (grão, light leak, vinheta) e HTML do próprio usuário fora da v1? (sim)
17. **D2:** ProRes 4444 com alfa por padrão ao exportar XML/EDL, com aviso de tamanho? (sim)
18. **F:** rampa sempre com correção de tom na v1; no OTIO/XML/EDL, rampa em degraus de velocidade média, com aviso? (sim)

**Uma de segurança, fora das frentes**

19. Restringir o CORS da API local (defeito 15)? (sim, num commit próprio)

---

## 10. Riscos transversais

| Risco | Mitigação |
|---|---|
| Números medidos no Linux não valerem no Windows | cada número decisivo tem script de medição para a sua máquina e um critério de aceite (seção 8) |
| Escopo grande para uma pessoa (≈ 84 dias de núcleo; ≈ 170 com tudo) | quatro marcos; cada frente tem corte mínimo; nada dos marcos 3 e 4 bloqueia os anteriores |
| Chats paralelos editando o mesmo arquivo | tabela 4.3; "commit só dos seus trechos"; canônico a cada commit |
| Som e imagem mudarem de propósito (A deixa o compressor mais alto; os defeitos 1, 2 e 6 mudam o arquivo) | cada mudança passa por teste e pelo seu aval; o harness da B mostra o antes e o depois |
| Atualização automática do Edge mudar a rasterização, o áudio ou a matriz de cor | `assinatura()` do navegador no cache (D1); Chrome Headless Shell opcional fixa a versão; perfis "estrito" e "deriva" na B; G0 mede a matriz |
| Alarme falso na revisão (H) com limiares calibrados para motion graphics | calibração em 3 projetos reais na etapa E0; gravidade baixa e "ignorar" em tudo que não é defeito objetivo |
| Rede bloqueada nas sessões na nuvem impediu algumas leituras (licença do GSAP, guia de legendas da Netflix, preços oficiais do Gemini, Chrome for Testing) | pendências marcadas nos planos; conferir no chat local, que tem rede |

---

## 11. Correções à pesquisa anterior

A análise detalhada corrigiu vários pontos de `docs/PESQUISA_HYPERFRAMES.md`. Os principais (detalhes nas seções
indicadas de cada plano):

- **§1 e §4.5 (Parakeet).** "Hoje tempo por palavra local exige o Canary" está errado: o Whisper local já devolve tempo
  por palavra (`motores.py:290-299`). O ganho do Parakeet é velocidade, estabilidade e texto pontuado. São 25 línguas no
  total (inglês incluído), o português do treino é europeu, os WER citados (6,05 % e 7,44 %) são do v2 em inglês, e o
  HyperFrames não sobrepõe janelas: corta no silêncio. (E)
- **§1 e §4.1 (áudio).** As divergências são maiores que "2,06 dB e o gate": compressor de 0,6 a 19 dB, EQ até 2 dB, mono
  −3 dB, 6 ms de latência. Servir o WAV pela rota interna é inviável (origem insegura, e o `addModule` do gate não passa pela
  rota). EQ sozinho não precisa de navegador. Os avisos devem ser reescritos, não apagados: a reserva FFmpeg continua. O
  HyperFrames aplica o envelope depois da cadeia, o contrário do contrato E2 do Talho. (A §3.2)
- **§4.2 (legendas).** SRT/VTT/ASS não funcionam pelo backend; karaokê não é só um preset (o Titler desenha um `<span>`
  só); "3 a 5 palavras por grupo" vale só para o modo dinâmico; a regra de luminância com blend não vale para o clássico.
  (C §2.3)
- **§4.3 (composições).** `hasDamage` não serve para deduplicar fora do BeginFrame; `heatmap` é shader WebGPU;
  `nyc-paris-flight` é uma ilustração com som; texturas são o pior caso e saem da v1; só 2 dos 13 lower thirds declaram
  variáveis; o mapa depende de d3, topojson e world-atlas por CDN. (D2 §3.2)
- **§4.4 (navegador).** O HyperFrames só liga BeginFrame em Linux, e o BeginFrame não preserva alfa. As flags
  "úteis sem BeginFrame" são justamente as só de BeginFrame. `--force-color-profile=srgb` e a escala 1 já vêm do
  Playwright. (D1 §3.2)
- **§4.6 (áudio avançado).** O voice carve não é "só uma cadeia comum de EQ" no Talho: o EQ tem topologia fechada
  (HPF + 3 bandas) e o carve exige ampliar o contrato E2. O nivelador não é coberto pelo loudnorm (este é por mídia, com
  ganho único; o nivelador iguala dentro do clipe). O librosa existe só no `.venv-nemo` e é impraticável em produção; as
  batidas vão por um porte em numpy. (F)
- **§4.7 (cor).** O Talho não detecta V-Log/S-Log/D-Log: a detecção automática só reconhece HLG e PQ pela etiqueta
  (`src/color/deteccao.py`); os perfis log ficam para a auditoria humana. A LUT técnica não precisa de WebGL no preview:
  basta assá-la no proxy. (G)
- **§4.8 (regressão).** Já existem testes de pixel (blend contra a fórmula W3C, desfoque do título contra o Chromium); falta
  a imagem do arquivo produzido, o som e a comparação com o Program. O `psnr.ts` citado é a peça errada (o harness usa
  `psnrAtFrames`, por índice de quadro), e o HyperFrames aceita 30 dB, um gate frouxo. (B §2.5)
- **§4.9 (revisão).** Contraste e área segura não vão no preflight (que é barato e pode bloquear): vão numa seção
  "Revisão" separada, sem nível de bloqueio. O método de contraste do HyperFrames não serve para texto sobre vídeo (ele
  pula fundo transparente); vale portar as contas, não o método. A camada grátis da revisão não precisa esperar o
  copiloto voltar a ser o foco. (H)
