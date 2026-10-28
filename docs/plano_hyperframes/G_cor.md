# Frente G — Cor: etiqueta HD, LUT técnica e criativa, curvas, sugestão de correção e HDR → SDR

> **Resumo.** **Entrega:** cor "tela = arquivo" em 6 fases: (G1) export HD com matriz e etiqueta bt709 corretas; (G2–G3) transformação técnica de entrada por mídia — HDR→SDR e LUT log→Rec.709 — assada no proxy (preview sem custo) e repetida no master no mesmo ponto da cadeia; (G4) sugestão de correção por `signalstats`; (G5) curvas por canal (SVG ao vivo + `lut1d` no render); (G6) LUT criativa por WebGL2.
> **Valor:** corrige hoje um desvio silencioso em todo export (29,5 dB contra o ideal, `color_space=unknown` [medido]), conserta celular HLG e libera câmera log sem WebGL. **Esforço: ≈ 25 dias úteis** (corte mínimo G0–G2 ≈ 8; G6 é opcional, com portão).
> **Dependências:** frente B (harness e cenários `cor_hd_matriz`, `cor_lut_cube`); `zscale` no ffmpeg Jellyfin do Fernando [a medir]. **Principal risco:** o Edge decodificar fonte sem etiqueta com matriz diferente da assumida; mede-se antes (G0) e o proxy passa a ser etiquetado.
> **Decisão principal:** a transformação técnica nasce numa função só (`filtro_entrada`), usada pelo proxy e pelo master, e o master compõe em RGB até uma única conversão final (46,6 dB contra 38,6 dB do remendo YUV→YUV).
> Marcas: **[lido]** código conferido · **[medido]** no sandbox (ffmpeg 6.1.1; repetir na máquina do Fernando) · **[a medir]** · **[inferência]** · **[web: URL]**. Nomes novos levam "(novo)".

## 1. Objetivo e valor

Hoje o Talho promete "o arquivo sai igual à tela" para sete controles de cor (brilho, contraste, saturação, matiz, sépia, cinza, desfoque). Quatro lacunas aparecem no material do Fernando:

1. **Todo export HD sai sem etiqueta e com a matriz errada** (`color_space=unknown`; 29,5 dB contra o ideal quando um visualizador lê como Rec.709 [medido]). Atinge 100 % dos arquivos, em silêncio.
2. **Celular HLG/PQ, drone e câmera log** (V-Log, S-Log, D-Log) não têm tratamento: chegam lavados ou diferentes entre tela e arquivo, e não há onde pôr uma LUT.
3. **Corrigir é tentativa e erro**: nada diz onde estão pretos, brancos e saturação do plano.
4. **Faltam curvas e LUT criativa**, o que o colorista usa depois do básico (a wiki 11 já as promete, `wiki/11.-Cor-Grading-e-Transformacoes-Visuais.md:29-42`, mas o código só tem os sete controles).

Ordem por valor/esforço: etiqueta HD (G1) → HDR→SDR (G2) → LUT técnica (G3) → sugestão (G4) → curvas (G5) → LUT criativa (G6). **Fora do escopo:** OCIO completo, rodas lift/gamma/gain, secundárias HSL, scopes, LUT em foto RAW.

## 2. Estado atual no Talho
| Tema | Fato [lido] | Onde |
|---|---|---|
| Efeito `color` | 7 parâmetros: brilho/contraste −100..100, saturação 0..200 (100 = neutro), matiz ±180, sépia/cinza 0..100, desfoque 0..20. Sem LUT, curva ou temperatura; `grep` de `.cube`, `lut3d`, `haldclut` em `src/` = 0 | `timelineInteraction.js:8651-8693`, `cor.py:188-194` |
| Render da cor | 2 `lutrgb` (brilho, contraste), até 4 `colorchannelmixer`, `gblur`; um estágio por função porque o CSS grampeia entre elas; bloco todo neutro = sem filtro | `cor.py:17-41,155-231` (neutro `:196-198`) |
| Ponto na cadeia do clipe | retime/`tpad` → `format=rgba` → `filtro_fit` → `cadeia_cor` → alfa/crop/transform. Camada de ajuste: `format=rgba` + `cadeia_cor` sobre cópia do fundo | `grafo_video.py:381-416`, `:1007-1009` |
| Player | o mesmo shorthand em 3 lugares: clipe (números exatos), matte e camada de ajuste (`toFixed(2)`, arredonda até 0,005: desvio pequeno de paridade); ajuste usa `backdrop-filter` | `player.js:4725-4750`, `:4406-4430`, `:88-118`, `:4567-4570` |
| Render Cache (JS) | `_isHeavyCut` marca cor como pesada; `compositeFrame` faz `drawImage(<video>)` sem `ctx.filter`, então o cache não "assa" a cor [lido; efeito a confirmar] | `renderCache.js:84-113`, `:335-430` |
| Fonte | master = original, rascunho = proxy; o player toca o proxy; original ausente nunca cai calado | `midia.py:1-24`, `:203-218`; `player.js:1954` (via `midia.py:12`) |
| Proxy | `scale`+`pad`, libx264 CRF 23, 1280x720, sem filtro de cor nem etiqueta: YUV→YUV passa direto e herda (ou não) as tags da fonte. Auditoria: 41 proxies sem tag, 10 `yuvj420p` pc | `ffmpeg.py:297-330`, `config.py:121-123`, `auditar_cor.py:11-12` |
| Export | cadeia final `scale→pad→fps→format=yuv420p`; encoder sem `-colorspace/-color_*`; grep em `comando.py` e `execucao.py` sem `bt709`, `zscale`, `in/out_color_matrix` (a frente B repetiu no diretório todo). `master_1080` e `reels_916` nem forçam `yuv420p` | `comando.py:150-172,707-719` |
| Pontos que voltam a YUV no meio do grafo | `overlay=` (devolve yuv420p) e `format=yuv420p` | `grafo_video.py:745,941-943,984,1078,1143`, `comando.py:653,801` |
| Detecção de perfil | só tags: `smpte2084→pq`, `arib-std-b67→hlg`, `log100/log316→log`. `slog3`, `vlog`, `nlog`… estão em `PERFIS_CONHECIDOS` e **ninguém os atribui** ("FASE 0 = SÓ TAGS"); `origem='humano'` é protegida contra releitura | `deteccao.py:28-38,42-61`; `media.py:97-113`; `schema.py:807-817` |
| Ambiente | ffmpeg 7.1.4 Jellyfin ("nesta máquina"); só se sondam **encoders**, nunca filtros; `PLANO_COR_OCIO.md` é citado em 3 arquivos e **não existe** no repositório | `execucao.py:28`, `ffmpeg.py:243-271`; `find` |
| Fidelidade e escopo | tipo de efeito desconhecido gera aviso (nunca ignorar em silêncio); `color` é uma categoria só; `disabled` = bypass (P5) | `fidelidade.py:28-31`, `modelo.py:63-68` |
| OTIO | `effects` vai cru em `metadata.capiau`; não há exportador XML/EDL no repositório | `otio_export.py:237,289`, `ls src/export` |

**Invariantes que a frente respeita:** (I1) o CSS do player é a fonte da verdade e `cor.py` o traduz (`cor.py:1-15`); (I2) `disabled:true` é ausência, nunca preto (P5); (I3) timeline antiga sai **byte a byte** igual (teste de snapshot do grafo); (I4) paridade player × FFmpeg e passar no cenário canônico multipista em cascata (`.agents/rules/nle-parity-and-media-lifecycle.md` §3); (I5) com WebGL, toda textura/`ImageBitmap` descartada é liberada na hora (§2.4); (I6) master não troca original por proxy calado (`midia.py:8`); (I7) nada é ignorado em silêncio: o que o motor não faz vira aviso em `fidelidade.py`.

## 3. O que o HyperFrames tem
| Peça (HF:packages/core/src/) | Veredito | Nota |
|---|---|---|
| `colorLuts.ts:95-195` leitor `.cube` (`DOMAIN_*`, `LUT_3D_INPUT_RANGE`, limite de tamanho, erro com nº da linha) | **Portar** para `src/color/cubo.py` (novo) | HF recusa 1D (`:157-176`) e limita a 64 (`:33`); o Talho aceita 1D (curvas) e 65 (Resolve) |
| `colorLuts.ts:206-226` empacota 3D em textura 2D RGBA8 | **Não portar** | 8 bits por entrada causa degraus em LUT log; usar `TEXTURE_3D` `RGBA16F` no WebGL2 |
| `runtime/colorGrading.ts:1170-1201` trilinear manual (8 amostras) | Inspirar-se | com textura 3D o filtro linear de hardware faz o mesmo |
| `colorGradingCurves.ts:34-70,153-168` spline monótona, tabela de 1024, ≤ 16 pontos (`parsers/src/colorGradingContract.ts:3`) | **Portar** (Python e JS, vetores dourados) | no Talho a tabela é de 256 (um valor por nível de 8 bits) |
| `mediaGradeAnalyzer.ts:315-346` 5 quadros com `fps,format=yuv444p,signalstats,metadata=print` | **Portar a medida** | a decisão (`:203-262`) é reescrita: HF supõe range limitado (`:198-199`) e usa parâmetros que o Talho não tem |
| `hdrToneMap.ts:15-28,30-41` `zscale`+`hable`; tags do 1º quadro por `showinfo` | **Adaptar** | ordem dos filtros e `format=gbrpf32le` diferem da receita do wiki do FFmpeg: decidir na medição |
| `skills/media-use/luts/index.json` + `packages/cli/src/media-use/lib/cube-build.mjs` | Inspirar-se | "looks" com `params` que geram o `.cube` sem rede; só portar `buildCube` se o Fernando quiser looks prontos |
| Modelo `HfColorGrading` completo (rodas, secundárias, hueCurves, detalhes) | Fora do escopo | backlog |

**HF não resolve:** log de câmera (`log:"unknown"`, `mediaGradeAnalyzer.ts:295`, aviso `:281-285`), etiqueta HD do export nem proxies. **Licença:** Apache-2.0 dentro de GPLv3 é permitido; manter "Copyright 2026 HeyGen, Inc." nos derivados e criar `CREDITOS_TERCEIROS.md` (novo) [inferência].

## 4. Verificações de viabilidade

Marcas: **[lido]** código conferido · **[medido]** medi neste sandbox (Linux, ffmpeg 6.1.1, numpy; `rascunho_G/exp_cor.py`), não na máquina do Fernando, e por isso repetido como [a medir] · **[web]** fonte externa · **[inferência]** dedução minha.

### 4.1 Etiqueta de cor do export HD — veredito: **confirmado e corrigível; compor em RGB até uma única conversão final**
- [lido] `comando.py:707-719` termina em `…fps=N,format=yuv420p`; o encoder (`-c:v`, ~`:727`) não recebe `-colorspace`, `-color_primaries`, `-color_trc` nem `-color_range`.
- [medido] estrutura do Talho (base `lavfi` yuv420p + `overlay` + `scale/pad/fps/format`), barras SMPTE HD 1280x720; PSNR do quadro decodificado contra o RGB original:

| variante | tags no arquivo | lido como 709 | lido como 601 |
|---|---|---|---|
| atual | `unknown` | **29,5 dB** | 47,3 dB |
| A: `scale=out_color_matrix=bt709:out_range=tv` antes do `format=yuv420p` + 4 tags | bt709/tv | 38,6 dB | 30,0 dB |
| B: base `format=gbrp`, `overlay=format=gbrp`, mesma conversão final + 4 tags | bt709/tv | **46,6 dB** | 30,1 dB |

  Leitura: o `overlay` devolve yuv420p e converte o RGBA do clipe com a matriz padrão do swscale (601) **dentro** do grafo; o remendo A reconverte YUV→YUV e perde 8 dB; só B chega ao teto da subamostragem 4:2:0. A meta ≥ 40 dB do cenário `cor_hd_matriz` (frente B, tabela 4.6) pede B.
- **Onde entra (G1):** (i) `comando.py:718`: trocar o sufixo por `,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p` **sempre**, inclusive em `master_1080`/`reels_916`, que hoje não forçam `yuv420p` (sem o `format` explícito o auto-scaler seguinte volta à 601); (ii) após `-c:v` acrescentar `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`, conferir `colr`/VUI com `ffprobe` (e `-movflags +write_colr` se faltar) e se os encoders de hardware aceitam os rótulos [a medir]; (iii) para ficar em B: base `format=gbrp` e os 7 `overlay=` (`grafo_video.py:745,941,984,1078,1143`; `comando.py:653,801`) com `format=gbrp`, e `format=yuv420p` de `grafo_video.py:943` vira `gbrp`. Custo de CPU do 4:4:4 [a medir]; se passar de ~30 %, ficar em A (38,6 dB) e registrar.
- **A partir de que altura:** com etiqueta explícita a altura não importa no export: **sempre bt709**, até 854x480 (`whatsapp_leve`); a 601 só serviria a DVD/PAL, que o Talho não entrega. A regra por altura vale só para **fonte sem etiqueta**: altura > 576 ou largura ≥ 1280 → bt709, senão smpte170m (convenção de players como mpv/VLC) [inferência].
- **Lado da entrada:** `format=rgba` (`grafo_video.py:414`) usa a matriz do quadro e, sem etiqueta, o swscale cai em BT.601 [web: https://forum.videohelp.com/showthread.php?p=2591801, "bt601 is default"]. As 259 MTS e 3 mp4 sem tag são HD de fato Rec.709 (`deteccao.py:6-14`): o export já as decodifica errado. Correção: `scale=in_color_matrix=bt709` antes do `format=rgba` quando `video.color_space` é nulo e a altura > 576.
- **Como o navegador decodifica o proxy: não está estabelecido.** O proxy herda a tag (ou a falta dela) da fonte. A busca só devolveu code reviews do Chromium de 2015–2017, nos quais a heurística por altura foi revertida (revisor: tamanho não serve em MSE) e o padrão antigo era 601 [web: https://codereview.chromium.org/1230593005/]; a referência que a frente B usa para "HD = 709" não prova o comportamento atual. **[a medir no Edge do Fernando]** (G0): SMPTE 709 1280x720 em três versões (sem tag, `bt709`, `bt601`), `drawImage`+`getImageData`, comparado ao RGB ideal. O resultado diz (a) quanto a tela erra hoje nas fontes sem etiqueta e (b) se o Edge obedece à tag; se obedece, a regra é assumir no FFmpeg a matriz verdadeira por altura (709 acima de 576) e **etiquetar o proxy**, para o navegador não adivinhar. Os proxies atuais se etiquetam sem recodificar: `-c copy -bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0` [inferência: opção do filtro de bitstream; a medir].

### 4.2 LUT técnica por mídia (log → Rec.709) — veredito: **viável sem WebGL; o custo é regenerar só os proxies das mídias com LUT**
- **A detecção não é a que a pesquisa disse.** `docs/PESQUISA_HYPERFRAMES.md` 4.7 afirma que a Fase 0 "já detecta V-Log, S-Log, D-Log"; o código só detecta HLG/PQ por tag (seção 2) e câmeras raramente etiquetam log (a HF admite `log:"unknown"`). O perfil log vem de: (a) escolha humana (`color_profile_origem='humano'`, já protegida); (b) sugestão por metadados da câmera em `format.tags` [a medir: listar as tags dos arquivos log do acervo]; (c) sugestão por imagem (YHIGH−YLOW e SATAVG baixos, 4.6). (b) e (c) são **chips que o Fernando aceita**, nunca automáticos.
- **Mesmo ponto da cadeia, uma função só:** `filtro_entrada(spec) -> str` em `src/color/transformacao.py` (novo) alimenta `generate_video_proxy` (antes do `scale`, `ffmpeg.py:314`) e `cadeia_clipe` (logo depois de `format=rgba`, antes de `filtro_fit` e `cadeia_cor`, `grafo_video.py:414-416`). A LUT recebe RGB já com a matriz certa: `scale=in_color_matrix=…,format=rgb24,lut3d=file=…:interp=tetrahedral` no proxy; `lut3d=…` no master (já em rgba).
- **Rascunho não converte duas vezes:** `FonteClipe` (`midia.py:51-61`) ganha `transform_embutida` (hash assado no proxy). Fonte `original` ⇒ aplica; `proxy` com hash igual ao atual ⇒ não aplica; `proxy` desatualizado ⇒ o rascunho usa o original, como já faz "sem proxy" (`midia.py:217-218`), e avisa `PROXY_DESATUALIZADO`. Mudança estrutural: hoje `montar_comando` monta o grafo (`comando.py:306`) **antes** de `resolver_fontes` (`:666`); a resolução sobe e o grafo recebe `rel_midia`.
- **Regenerar:** `video.input_transform` (desejado) × `video.proxy_transform_hash` (assado); fila no `TASK_MANAGER` como `ingest.py:~317`, arquivo `.tmp` + troca atômica, `?v=<hash8>` no `src` do player, miniaturas refeitas. Só a mídia afetada, nunca o acervo em lote.
- **Custo** [a medir]: tempo ≈ um proxy novo (libx264 `fast`, CRF 23; alvo ≤ 0,5× a duração da fonte no i7-10700); disco líquido ≈ 0 (o novo substitui o antigo; pico = 1 proxy extra); LUT 33³ ≈ 1 MB, 65³ ≈ 8 MB.
- **Paridade:** `tetrahedral` × `trilinear` do FFmpeg diferem em no máximo 1 nível (p99 = 0) numa LUT de brinquedo 33³; ambos erram até 4 níveis contra a função exata, por causa da própria amostragem 33³ [medido]. Ficar em `tetrahedral` e aceitar ≤ 2 níveis contra o WebGL.

### 4.3 LUT criativa como efeito — veredito: **WebGL2 só em clipe (com prova de conceito); camada de ajuste só por Render Cache**
- CSS `filter` não aplica LUT 3D e o SVG também não: entre as 17 primitivas, `feColorMatrix` é 4x5 e `feComponentTransfer` é 1D por canal; o truque de `feDisplacementMap` com imagem HaldCLUT é impreciso e frágil [inferência].

| Opção | Latência | Paridade com `lut3d` | Custo | Camada de ajuste |
|---|---|---|---|---|
| WebGL2 por clipe (`<canvas>` no lugar do `<video>` quando há LUT; filtros CSS seguintes ficam no canvas) | tempo real | trilinear de hardware, esperado ≤ 2 níveis [a medir] | GPU: `texImage2D(video)` por quadro; textura 3D `RGBA16F` | **não** (o fundo do `backdrop-filter` não é textura) |
| Render Cache pelo FFmpeg (trecho com `lut3d`) | segundos a minutos | exata (mesmo grafo) | CPU + disco por trecho | sim |
| Proxy de prévia por clipe × LUT | minutos | exata | disco por (mídia × LUT) | não |

- **Recomendação:** G6a é uma prova de conceito de 1 dia com portão: `texImage2D` de `<video>` a 720p sem perder quadro com 2 clipes ao mesmo tempo e `max_abs ≤ 2` contra o export. Só então G6b. O canvas existe só nos clipes com LUT (não mexe no pool de `<video>`; texturas liberadas no descarte, regra §2.4; sincronismo por `requestVideoFrameCallback`). Camada de ajuste com LUT: sem prévia ao vivo, aviso `LUT_SEM_PREVIA_AO_VIVO`, prévia pelo Render Cache (G6c).
- **Ordem na cadeia:** LUT técnica (mídia) → **LUT criativa** → 6 funções do bloco → curvas → desfoque. A criativa é o "look-base" e os controles ajustam por cima; no player é natural (canvas WebGL, depois o `filter` CSS no mesmo canvas).

### 4.4 Curvas por canal — veredito: **viável, com três condições; a confirmação final é uma medição no Edge**
- `filter: url(#id)` em `<video>`: referência a filtro SVG vale em qualquer elemento HTML no Chromium [inferência: recurso antigo]. Em `backdrop-filter`, relatos dizem que funciona no Chrome e não no Safari [web: https://www2.webkit.org/show_bug.cgi?id=245510], e a WPT `css/filter-effects/backdrop-filter-svg.html` usa `feComponentTransfer` [web: https://dxr.mozilla.org/mozilla-central/source/testing/web-platform/tests/css/filter-effects/backdrop-filter-svg.html]. Nada cobre `<video>` + `backdrop-filter` + `url()`: **[a medir]** (G5b, 0,5 dia) numa página de teste no Edge.
- **Condições:** (1) `color-interpolation-filters="sRGB"` no `<filter>`: o padrão do SVG é `linearRGB` e as funções do Talho são sRGB (`cor.py:9-15`); a WPT também fixa sRGB; (2) o `<svg>` fica no DOM como bloco 0x0 absoluto, nunca `display:none` [inferência: quirk conhecido]; (3) **uma tabela de 256 valores por canal**, gerada dos pontos de controle por spline monótona (PCHIP) em Python e em JS com os mesmos vetores dourados (`tests/dados/curvas_pchip.json`, novo; diferença ≤ 1e-6). `feComponentTransfer type="table"` interpola linear entre valores: com 256 entradas, cada nível de 8 bits cai exatamente num valor da tabela.
- **Render:** `lut1d=file=curva.cube:interp=linear` com a **mesma** tabela (3 colunas R,G,B; a ordem canal → mestre é composta numa tabela só, e o SVG usa 3 `feFunc`). [medido, ffmpeg 6.1.1] com 256 pontos e `linear` a saída erra ≤ 1 nível, mas 127 dos 256 níveis diferem de 1 (parece truncar em vez de arredondar): somar 0,5/255 à tabela do arquivo e remedir [a medir]; o teste aceita `max_abs ≤ 2`. `curves=…:interp=pchip` direto não serve: a spline do FFmpeg não é a nossa (±1–2 níveis) [inferência].
- **Paridade** (B Nível 2): rampa 0–255 + barras SMPTE + gradiente, curva S e curva só-R, `filter:url()` e `backdrop-filter:url()` no Edge × export; alvo `max_abs ≤ 2`, ≥ 45 dB.

### 4.5 Leitor/validador `.cube` e biblioteca — veredito: **simples (≈ 150 linhas); o cuidado é o caminho no Windows**
- `src/color/cubo.py` (novo), porta de `HF:colorLuts.ts:95-195`: `TITLE`, `DOMAIN_MIN/MAX`, `LUT_3D_SIZE` 2..65, `LUT_3D_INPUT_RANGE`, `LUT_1D_SIZE` (curvas), BOM/CRLF, comentário `#`, número finito, contagem exata (`N³` linhas, R varia mais rápido), erro com nº da linha, arquivo ≤ 16 MB; devolve `numpy float32`; recusa 1D+3D misturados e `LUT_*` desconhecido, como o HF. Parse de 65³ em ≤ 300 ms [a medir].
- **Onde guardar:** `CONFIG.LUTS_DIR / "<sha256[:16]>.cube"` (novo, ao lado de `PROXIES_DIR`, `config.py:112`) + tabela `lut` (seção 6). O JSON referencia `lut.id` (hash do conteúdo canônico), **nunca caminho**: encaixa na mídia portátil de `docs/PLANO_NUVEM.md:81,180-188` (hoje só para originais: volume + caminho relativo + hash); a LUT, pequena, vira ativo do projeto sincronizável (S3, como os proxies em `ingest.py:~350`). Nenhuma LUT de fabricante é embarcada (licença); o Fernando importa.
- **FFmpeg no Windows:** `lut3d=file=C:\Users\FGC\dev\capiau\talho\data\luts\ab12.cube` quebra por `:` e `\` (escape em dois níveis). Helper `escapar_arg_filtro()` (novo) com teste desse caminho, de um com espaço e de um com acento; plano B: copiar a LUT para a pasta temporária do render com nome ASCII curto e usar nome relativo.

### 4.6 Sugestão de correção (porta do `mediaGradeAnalyzer`) — veredito: **níveis, exposição e saturação cabem nos parâmetros atuais; temperatura e matiz exigem parâmetros novos**

| Controle da HF | Dá com o efeito `color` atual? | Tradução |
|---|---|---|
| exposição | sim | `brightness` (ganho multiplicativo em sRGB, `cor.py:155-158`) |
| pretos, brancos, contraste | sim, em forma fechada | levar P10→`Tl`=0,10 e P90→`Th`=0,88 (`YLOW`, `YHIGH` do `signalstats`): `G=(Th−Tl)/(YHIGH−YLOW)`, `kc=2·G·YLOW+1−2·Tl`, `kb=G/kc`; `brightness=(kb−1)·100`, `contrast=(kc−1)·100` (brilho antes do contraste, como no CSS). Conferido à mão: YLOW=0,25, YHIGH=0,75 → kc=1,58, kb=0,987; checar `kb·YHIGH ≤ 1` (senão o CSS grampeia) e os limites ±100 dos sliders |
| saturação | sim | `saturation = 100·alvo/SATAVG`, alvo = mediana do acervo [a medir] |
| temperatura, matiz (balanço de branco) | **não** | 2 parâmetros novos `temperature` e `tint` → ganhos por canal (kr,kg,kb): `cor.py` com `colorchannelmixer` diagonal (ou `lutrgb clip(val*k)`); player com `feComponentTransfer type="linear" slope=k` (infra SVG da G5, por isso entram em G5c) |

- **Range:** a HF supõe range limitado (`YLOW ≤ 16`, `YHIGH ≥ 235`, `HF:mediaGradeAnalyzer.ts:198-199`); o acervo tem Canon `yuvj420p`/pc. Normalizar com `resolver_range` (`deteccao.py:77-96`): (Y−16)/219 ou Y/255.
- **Onde medir:** no **proxy** (é o que se vê, já com LUT/HDR assados), só na faixa [in,out] do clipe (`-ss in -t dur`), 5 amostras, ~0,3–0,6 s [a medir]. Botão "Sugerir" mostra antes/depois e desfaz; nunca automático. Plano "parece log" (spread baixo e SATAVG baixo) sugere a LUT técnica em vez de esmagar com contraste.

### 4.7 HDR → SDR — veredito: **viável com `zscale`+`tonemap`; falta confirmar `zscale` no ffmpeg Jellyfin do Fernando**
- **Detecção:** `pq`/`hlg` já vêm das tags (`deteccao.py:55-57`), mas só do *stream*; celular e drone às vezes só trazem a tag no quadro ⇒ ler o 1º quadro com `showinfo` (`HF:hdrToneMap.ts:30-41`).
- **Hoje:** o proxy mantém a etiqueta HLG/2020 da fonte (YUV→YUV) e o Edge aplica, ou não, o próprio mapeamento de tons; o export lê o original com `format=rgba`, que ignora a transferência ⇒ tela ≠ arquivo [inferência; a medir]. Solução: converter **uma vez, na mesma cadeia**, no proxy e no master; o proxy sai SDR com etiqueta bt709 e o navegador não decide nada.
- **Cadeia** (receita do wiki do FFmpeg): `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv` (+ `format=yuv420p` no proxy; no master segue para `format=rgba`). A HF (`hdrToneMap.ts:27`) converte as primárias só no fim e omite o `format`; comparar as duas em clipes reais (iPhone HLG, drone) e escolher por luma médio e PSNR proxy × master ≥ 45 dB [a medir].
- **`zscale` no Jellyfin:** o nome do pacote portátil `jellyfin-ffmpeg_7.1.4-3_portable_win64-clang-gpl` e uma spec Fedora do jellyfin-ffmpeg 7.1.2 com `libzimg` e `libplacebo` aparecem nos resultados da busca [web: https://sourceforge.net/app/jellyfin-ffmpeg/ ; https://download.copr.fedorainfracloud.org/results/pyra/jellyfin-ffmpeg/fedora-39-x86_64/06877127-jellyfin-ffmpeg/jellyfin-ffmpeg.spec; li só o resumo da busca, não a spec], mas nenhuma fonte mostra a build Windows ⇒ **[a medir]** `ffmpeg -hide_banner -filters | findstr "zscale tonemap tonemapx"` e `ffmpeg -buildconf | findstr zimg`. No sandbox (ffmpeg 6.1.1) existem `zscale`, `tonemap`, `lut3d`, `lut1d`, `curves`, `signalstats`, `colorspace`; `tonemapx` (só Jellyfin) não [medido].
- **Descoberta e aviso:** hoje só se sondam encoders (`ffmpeg.py:243-271`, com cache). Criar `src/media/capacidades.py` (novo): `ffmpeg -hide_banner -filters` e `-buildconf` uma vez, cache por (caminho, mtime), `exigir("zscale")` com erro em português; exposto na API e no banner de fidelidade (`FILTRO_AUSENTE`). Master com clipe HDR e sem filtro **recusa** (como original ausente, `midia.py:8`); rascunho avisa. Dolby Vision perfil 5 não é mapeável por `zscale` (cores trocadas): detectar e avisar [inferência].

## 5. Decisões de projeto
| # | Decisão | Alternativas | Recomendação e motivo |
|---|---|---|---|
| D1 | Corrigir o export HD | (A) remendo YUV→YUV no fim; (B) RGB até uma conversão final; (C) só etiquetar | **B**, com A de reserva. C faria a etiqueta mentir (dados 601 declarados 709). B = 46,6 dB, A = 38,6 dB [medido] |
| D2 | Matriz de fonte sem etiqueta | seguir o palpite do Edge; regra por altura; perguntar | **Regra por altura (709 acima de 576) + etiquetar o proxy**, para o navegador não adivinhar; override humano por mídia (`origem='humano'`). G0 confirma que o Edge obedece à tag |
| D3 | Onde mora a transformação técnica | efeito do clipe; coluna da mídia | **Mídia** (`video.input_transform`): o proxy é por mídia e o preview sem custo vem daí |
| D4 | Como o preview vê a LUT técnica | WebGL; assar no proxy | **Assar no proxy**; o master usa a mesma `filtro_entrada`. WebGL fica só para a criativa |
| D5 | Onde ficam `lut`, `curves`, `temperature`, `tint` | tipos de efeito novos; campos no `color` | **Campos no `color`**, cada sub-objeto com seu `disabled`: mantém `bloco_cor`, a categoria "cor" do escopo, `_isHeavyCut` e "primeiro bloco de cada tipo" (tipos novos pediriam `EFEITOS_POR_CATEGORIA`, `fidelidade` e todo `effects.find` do player) |
| D6 | Curvas | `curves=` do FFmpeg; WebGL; SVG + `lut1d` | **SVG + `lut1d` com a mesma tabela** (4.4) |
| D7 | LUT criativa ao vivo | WebGL2; Render Cache; proxy de prévia | **WebGL2 em clipe**, com portão G6a; ajuste só por cache (4.3) |
| D8 | Intensidade da LUT | `split`+`blend` no grafo; misturar o cubo com a identidade | **Misturar o cubo com a identidade** (numpy, cache `<id>_<k>.cube`): cadeia linear, sem ramificar, igual ao `mix()` do shader |
| D9 | HDR | manual; automático | **Automático** para `pq`/`hlg` (chip "HDR→SDR" visível, desligável por mídia); master sem `zscale` recusa |
| D10 | Regenerar proxy | automático no acervo; manual; fila por mídia | **Fila por mídia, com custo estimado e botão**; nunca em lote global; troca atômica |
| D11 | Interpolação do `lut3d` | `tetrahedral`; `trilinear` | `tetrahedral` (default; ≤ 1 nível do trilinear, 4.2) |
| D12 | Escopo "cor" desmarcado (`modelo.py:63-68`) | desliga tudo; desliga só o criativo | **Só o criativo** (`lut`, `curves`, 6 funções): a transformação técnica é normalização, não escolha, e sem ela o master sairia diferente da tela |

## 6. Modelo de dados e compatibilidade

**Bloco `color` do clipe e da camada de ajuste** (`sequence_json` continua `version: 2`; campos novos opcionais, ausente = neutro):

```json
{"type":"color","brightness":0,"contrast":0,"saturation":100,"hue":0,"sepia":0,"grayscale":0,"blur":0,
 "temperature":0,"tint":0,
 "lut":{"id":"9f3a1c2b7d4e8a60","intensity":100,"disabled":false},
 "curves":{"interp":"pchip","m":[[0,0],[0.3,0.22],[1,1]],"r":null,"g":null,"b":null,"disabled":false},
 "v":2}
```

Ordem de aplicação, idêntica no player e no FFmpeg: `[transformação técnica da mídia] → lut → brightness → contrast → saturate → hue-rotate → sepia → grayscale → temperature/tint → curves → blur`. Camada de ajuste: sem `lut` na v1 (4.3).

**Mídia** (banco, não o `sequence_json`; segue o padrão de colunas de `schema.py:800-824`):

```sql
ALTER TABLE video ADD COLUMN input_transform TEXT;      -- desejado: {"tipo":"lut","lut_id":"…","interp":"tetrahedral"} | {"tipo":"hdr_sdr","tonemap":"hable"} | NULL
ALTER TABLE video ADD COLUMN proxy_transform_hash TEXT; -- hash do que está assado no proxy (NULL = nada)
CREATE TABLE IF NOT EXISTS lut (id TEXT PRIMARY KEY, nome TEXT NOT NULL, dimensao INTEGER, tamanho INTEGER,
  dominio_min TEXT, dominio_max TEXT, papel TEXT, entrada TEXT, saida TEXT, bytes INTEGER, importada_em TEXT);
```

`hash = sha1(json canônico + sha256 da LUT + versão do gerador)[:16]`; `papel` ∈ {tecnica, criativa, ambas}; `entrada`/`saida` ("vlog", "rec709") só filtram a lista na UI.

- **Timelines antigas:** sem os campos novos nada muda. Teste de snapshot: o grafo de 3 timelines reais (inclusive o canônico em cascata) é idêntico antes e depois; `cor.py:196-198` passa a olhar também os campos novos.
- **Motor antigo lendo JSON novo:** ignoraria `lut`/`curves` em silêncio, porque o aviso de `fidelidade.py:28-31` só pega *tipos* de efeito desconhecidos ⇒ campo `v:2` e aviso `COR_CAMPOS_DESCONHECIDOS` quando `v` > o suportado.
- **Proxies:** nome estável (`proxy_vid_{id}.mp4`, `midia.py:99`); troca atômica; `proxy_transform_hash`, `proxy_color_range` e `proxy_pix_fmt` (`schema.py:815`) atualizados; reenviar ao S3 se ligado. Embeddings e miniaturas de busca já gerados não são refeitos (só as miniaturas de timeline).
- **Render Cache (JS):** `_isHeavyCut` inclui `lut`, `curves`, `temperature`, `tint` (`renderCache.js:84-113`); mudar `input_transform` invalida os intervalos dos clipes da mídia (`invalidateRange`, com `bitmap.close()`, regra §2.4).
- **OTIO:** `metadata.capiau.effects` já leva o bloco cru (`otio_export.py:237,289`); acrescentar `lut_nome` e `sha256` e, opcionalmente, copiar o `.cube` ao lado. Resolve, Premiere e Kdenlive não leem esses campos: LUT e curvas **não viajam** (documentar). XML e EDL não existem no repositório.
- **Mídia portátil** (`PLANO_NUVEM.md` Fase 3): LUT por hash, sem caminho; `data/luts/` é ativo do projeto e sincroniza como os proxies.

## 7. Mudanças por arquivo

| Arquivo | Mudança |
|---|---|
| `src/export/video_render/comando.py:707-728` | sufixo `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p` sempre; 4 tags após `-c:v`; `:306`/`:666`: `resolver_fontes` sobe e o grafo recebe `rel_midia`; `:653,801` `overlay` em `gbrp` |
| `src/export/video_render/grafo_video.py:414-416` | `filtro_entrada` (matriz de entrada, HDR ou `lut3d`) logo após `format=rgba`, antes de `filtro_fit`/`cadeia_cor`; `:745,941-943,984,1078,1143` composição em RGB; `:1007-1009` ajuste só com curvas/ganhos |
| `src/export/video_render/cor.py` | neutro olha os campos novos; estágios na ordem da seção 6 (`lut3d` misturado, ganhos, `lut1d`); docstring atualizada |
| `src/export/video_render/midia.py:51-61,203-` | `FonteClipe.transform_embutida`; decisão original × proxy × desatualizado |
| `src/export/video_render/modelo.py:268-`, `fidelidade.py` | transformação da mídia chega ao clipe; avisos `FILTRO_AUSENTE`, `PROXY_DESATUALIZADO`, `LUT_SEM_PREVIA_AO_VIVO`, `COR_CAMPOS_DESCONHECIDOS`, `HDR_SEM_CONVERSAO` |
| `src/media/ffmpeg.py:297-330` | `generate_video_proxy(..., filtro_entrada, etiqueta)`; `ler_tags_primeiro_quadro`; BSF para etiquetar proxies antigos |
| `src/media/capacidades.py` (novo) | `-filters`/`-buildconf` com cache, `exigir()` |
| `src/color/cubo.py`, `transformacao.py`, `curvas.py`, `sugestao.py` (novos); `deteccao.py` | leitor `.cube`; `filtro_entrada`/hash; PCHIP e tabela de 256; `signalstats` e forma fechada; heurística por metadados como chip |
| `src/db/schema.py:800-824`, `repositories/media.py`, `src/config.py:112` | colunas, tabela `lut`, CRUD, `LUTS_DIR` |
| `src/api/routes/cor.py` (novo) | importar/listar LUT; perfil e transformação da mídia; regenerar proxy; sugerir; capacidades do ffmpeg |
| `src/services/ingest.py:~317` | passa o filtro, grava o hash, tarefa de regeneração |
| `src/export/otio_export.py:237,289` | `lut_nome`, `sha256` |
| `src/ui/js/corFiltro.js` (novo); `player.js:88-118,4406-4430,4725-4750` | `buildCssColorFilter(bloco, {backdrop})` único; some o `toFixed(2)` divergente |
| `src/ui/js/corSvg.js` (novo); `corLutGl.js` (novo, G6) | `<filter>` por hash, 256 pontos, sRGB; WebGL2 com ciclo de vida |
| `src/ui/js/renderCache.js:84-113`; `timelineInteraction.js:8636-8700`; `library.js` | `_isHeavyCut`; seções Curvas/LUT/Sugerir no inspetor; "Cor da mídia" (perfil, LUT técnica, HDR→SDR, estado do proxy, regenerar) |
| `wiki/11.-Cor-Grading-e-Transformacoes-Visuais.md`, `CREDITOS_TERCEIROS.md` (novo) | corrigir o que a wiki promete; atribuição Apache-2.0 |

## 8. Etapas

| # | Commit (conventional, pt) | Conteúdo | Testes | Dias | Dep. |
|---|---|---|---|---|---|
| G0 | `chore(cor): medições de cor no Edge e no ffmpeg` | `scripts/medir_cor.py` (novo): SMPTE 709 em 3 etiquetas + página de `drawImage`, `-filters`/`-buildconf`, tempo de proxy 1080p/4K; JSON de saída | rodar na máquina do Fernando | 1 | — |
| G1a | `fix(render): export com matriz e etiqueta bt709` | `comando.py` final + 4 tags; composição em `gbrp`; presets | `tests/test_cor_matriz_saida.py` (novo); B `cor_hd_matriz` N1; cascata | 1,5 | G0, B |
| G1b | `fix(render): matriz de entrada e proxies etiquetados` | `in_color_matrix` para fonte sem tag; etiquetar proxies sem recodificar | `test_cor_matriz_saida.py`; B `cor_hd_matriz` N2 | 1 | G1a |
| G2a | `feat(media): capacidades do ffmpeg e aviso` | `capacidades.py`, rota, banner | `test_cor_capacidades.py` (saídas reais de `-filters` como fixture) | 1 | — |
| G2b | `feat(cor): transformação técnica de entrada por mídia` | colunas, hash, `FonteClipe`, fontes antes do grafo, `filtro_entrada`, regeneração atômica | `test_cor_transformacao_entrada.py`; cascata | 2 | G1a |
| G2c | `feat(cor): HDR→SDR no proxy e no master` | cadeia `zscale`/`hable`, tags do 1º quadro, automático | fixture do comando; B `hdr_sdr` (proxy × master ≥ 45 dB) | 1,5 | G2a, G2b |
| G3a | `feat(cor): leitor .cube e biblioteca de LUTs` | `cubo.py`, `LUTS_DIR`, tabela, importação | `test_cor_cubo.py` (identidade, inversão, 65³, CRLF/BOM, erro com linha) | 1,5 | — |
| G3b | `feat(cor): LUT técnica por mídia` | `lut3d` em `filtro_entrada`, escape no Windows, "Cor da mídia", perfil humano | B `cor_lut_cube` N1 (identidade e inversão exatas); escape; cascata | 2,5 | G2b, G3a |
| G4 | `feat(cor): sugestão de correção` | `sugestao.py`, rota, botão e antes/depois | `test_cor_sugestao.py`; 20 clipes do acervo [a medir] | 2,5 | G2b |
| G5a | `feat(cor): curvas por canal no render` | `curvas.py`, `lut1d`, compensação 0,5/255 | `test_cor_curvas.py` + vetores dourados; B `cor_curvas` N1 | 2 | — |
| G5b | `feat(cor): curvas ao vivo por SVG` | `corFiltro.js`, `corSvg.js`, editor de curva; 3 builders viram 1 | `autoteste_cor_filtro_css.mjs`, `autoteste_cor_curvas_svg.mjs`; N2 | 2 | G5a |
| G5c | `feat(cor): temperatura e matiz por ganho` | parâmetros, `cor.py`, SVG linear, ligação com G4 | pytest + autoteste + N2 | 1 | G4, G5b |
| G6a | `spike(cor): WebGL2 com LUT` | descartável; mede custo e paridade; **portão** | relatório em `docs/` | 1 | G3a |
| G6b | `feat(cor): LUT criativa em clipe` | `corLutGl.js`, inspetor, intensidade, ciclo de vida | `autoteste_cor_lut_gl.mjs`; B `cor_lut_cube` N2; cascata | 3 | G6a |
| G6c | `feat(cor): LUT em camada de ajuste via Render Cache` | trecho renderizado pelo FFmpeg, aviso | cascata com ajuste + LUT | 1,5 | G6b |

**Total ≈ 25 dias úteis; corte mínimo G0–G2c ≈ 8.** G6 só segue se o portão de G6a passar.

## 9. Testes e medições
Tudo que toca render ou player passa no cenário canônico em cascata (`node tests/autoteste_composicao_multipista_cascata.mjs` e `pytest tests/test_render_composicao_multipista_cascata.py`), que ganha variantes com `lut`, `curves` e `temperature` no bloco de cor do clipe e da camada de ajuste. Cenários novos no harness da frente B: `cor_hd_matriz` (já previsto), `cor_lut_cube`, `cor_curvas`, `hdr_sdr`.

| Teste (novo, salvo indicação) | Garante |
|---|---|
| `tests/test_cor_matriz_saida.py` | `montar_comando` termina em `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`, leva as 4 tags e, em fonte HD sem tag, `in_color_matrix=bt709`; render de fumaça lido por `ffprobe` |
| `tests/test_cor_cubo.py` | LUT identidade e de inversão; erro com nº da linha; 65³; CRLF/BOM; 1D; recusas |
| `tests/test_cor_capacidades.py` | parser de `-filters`/`-buildconf` com saídas reais como fixture; `exigir()` |
| `tests/test_cor_transformacao_entrada.py` | hash estável; original aplica, proxy com o mesmo hash não, proxy velho cai no original; mesmo ponto da cadeia; escape do caminho Windows |
| `tests/test_cor_sugestao.py` | parser de `signalstats`; forma fechada leva P10/P90 aos alvos; range pc × tv; limites dos sliders |
| `tests/test_cor_curvas.py` | PCHIP × vetores dourados; tabela de 256; composição canal → mestre; `.cube` 1D |
| `tests/test_render_*.py`, `test_f12_cor_deteccao.py` (existentes) | passam sem alteração; snapshot do grafo de timelines antigas |
| `tests/autoteste_cor_filtro_css.mjs` | `buildCssColorFilter` devolve as strings antigas para 20 blocos antigos (clipe, matte, `backdrop`) |
| `tests/autoteste_cor_curvas_svg.mjs`, `tests/autoteste_cor_lut_gl.mjs` | 256 valores, `sRGB`, vetores dourados; GL falso: uma textura por LUT, `deleteTexture` no descarte, trilinear em CPU × vetores |

| Medida | Hoje | Alvo | Como |
|---|---|---|---|
| PSNR do export HD lido como 709 (barras SMPTE) | 29,5 dB [medido] | ≥ 45 dB (46,6 medido em B; mínimo aceito 40) | `cor_hd_matriz` N1 |
| `ffprobe` do export | `color_space=unknown` | `bt709`/`tv`/`bt709`/`bt709` | idem |
| Edge × SMPTE sem tag, com `bt709`, com `bt601` | desconhecido | com tag: ≥ 45 dB; sem tag: registrar o desvio | G0 |
| CPU do 4:4:4 no cenário canônico 1080p | — | ≤ +30 % sobre o atual | G1a |
| Tempo do proxy regenerado (duração do proxy ÷ duração da fonte) | — | ≤ 0,5×; tamanho ±10 % | G0, G2b |
| `lut3d` do FFmpeg × WebGL2 | `tetrahedral` × `trilinear` ≤ 1 nível [medido] | `max_abs` ≤ 2, ≥ 45 dB | G6a, `cor_lut_cube` N2 |
| Curva SVG × `lut1d` | ±1 por truncamento [medido] | `max_abs` ≤ 2 (≤ 1 após +0,5/255) | `cor_curvas` N2 |
| Program com 2 clipes 720p + curvas + LUT | — | ≤ 1 % de quadros perdidos em 60 s | G5b, G6a |
| Sugestão em 20 clipes do acervo | — | P10/P90 dentro de ±3 níveis dos alvos 0,10/0,88; < 0,5 % de pixels grampeados a mais; ≤ 0,6 s por clipe | G4 |
| HDR→SDR, proxy × master | — | ≥ 45 dB; luma médio dentro de ±5 níveis da cadeia escolhida | G2c |
| Parse `.cube` | — | 33³ ≤ 50 ms; 65³ ≤ 300 ms | `test_cor_cubo.py` |
| Timelines antigas | — | grafo idêntico (diff de 0 bytes) em 3 timelines reais | snapshot |

## 10. Critérios de aceite

- Export HD: `ffprobe` mostra `bt709`/`tv`; `cor_hd_matriz` ≥ 45 dB (mínimo 40); nenhum teste existente muda de resultado.
- Timelines antigas: grafo idêntico e cascata verde nas duas pontas (JS e Python).
- HDR: o clipe HLG do celular do Fernando tem proxy e master equivalentes (≥ 45 dB), sem aspecto lavado; sem `zscale` o master recusa com mensagem em português e o rascunho avisa.
- LUT técnica: uma câmera log do Fernando, com a LUT oficial, aparece igual no rascunho e no master; trocar a LUT regenera só aquela mídia; o rascunho nunca converte duas vezes; proxy desatualizado avisa.
- Sugestão: botão, antes/depois e desfazer; nada se aplica sozinho.
- Curvas: ao vivo no Edge (clipe e camada de ajuste) e no export com `max_abs` ≤ 2; `disabled` = ausência.
- LUT criativa: ao vivo em clipe, com intensidade, ou a etapa fica registrada como adiada porque o portão de G6a não passou.
- `.cube` inválido nunca derruba o app (erro com nº da linha); nenhum JSON guarda caminho absoluto.
- `wiki/11.-Cor-Grading-e-Transformacoes-Visuais.md` corrigida para o que existe.

## 11. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Edge decodifica fonte sem tag com matriz inesperada | tela ≠ arquivo nas 259 MTS | G0 mede; proxy etiquetado (BSF); override humano por mídia |
| Composição em `gbrp` pesa na CPU (i7-10700, sem GPU) | render mais lento | medir no canônico 1080p; reserva A (38,6 dB), que o rascunho pode usar |
| Regenerar proxies custa tempo e disco | espera; pico de 1 proxy extra | por mídia, em fila, com estimativa e troca atômica; nunca em lote |
| Proxy desatualizado mostra o look antigo | tela ≠ master por alguns minutos | chip na mídia + `PROXY_DESATUALIZADO`; rascunho usa o original |
| Dupla conversão (proxy já convertido + grafo converte de novo) | cor errada e difícil de ver | `transform_embutida` por hash; teste dedicado; `cor_lut_cube` |
| Caminho `C:\…` no `lut3d` | render falha só no Windows | helper de escape + teste com o caminho do Fernando; plano B: nome ASCII temporário |
| `zscale` ausente no Jellyfin portátil | HDR sem conversão | `capacidades.py`; master recusa; `tonemapx` ou outra build com zimg |
| Falso positivo na detecção de log | LUT errada | só chip, nunca automático; `origem='humano'` vence |
| WebGL: VRAM, pool de `<video>`, quadro dessincronizado | vazamento, gagueira | PoC com portão; canvas só em clipe com LUT; `deleteTexture` no descarte; `requestVideoFrameCallback`; regra §2.4 |
| SVG: custo e qualidade no Edge; `linearRGB` por padrão | curva diferente do export | `sRGB` explícito; medir quadros perdidos; sem prévia + aviso se falhar |
| `lut1d` com ±1 nível por truncamento | diferença de 1 nível | compensação 0,5/255; tolerância 2 |
| Dolby Vision perfil 5; HDR sem tag no stream | cores trocadas | detectar e avisar; 1º quadro com `showinfo` |
| Deriva de Edge ou ffmpeg | paridade quebra sem aviso | harness B Nível 2 e impressão digital do ambiente |
| Licença (Apache-2.0 em GPLv3) | — | atribuição nos derivados + `CREDITOS_TERCEIROS.md` |

## 12. Perguntas para o Fernando

1. **Rodar `scripts/medir_cor.py` no Edge e no ffmpeg (G0, 2 min)?** (Sim; ele decide a matriz das fontes sem etiqueta e confirma `zscale`, `lut1d` e `lut3d`.)
2. **Export sempre `bt709`, inclusive 854x480 do WhatsApp?** (Sim.)
3. **Fonte sem etiqueta como Rec.709 acima de 576 e proxy etiquetado?** (Sim, depois da medição; fica `origem='heuristica'` e você pode corrigir por mídia.)
4. **HDR de celular vira SDR sozinho no proxy e no master?** (Sim, com chip visível e desligável por mídia.)
5. **Quais câmeras em log você usa e tem as LUTs oficiais (.cube)?** (Começar por uma câmera; o app não embarca LUT de fabricante.)
6. **Regenerar o proxy ao trocar a LUT:** botão por mídia com fila e custo estimado, ou automático? (Botão + fila; nunca o acervo inteiro.)
7. **LUT criativa só em clipe ao vivo, camada de ajuste só depois do Render Cache?** (Sim na primeira versão.)
8. **Ordem LUT → brilho…cinza → temperatura/matiz → curvas → desfoque está certa para você?** (Sim.)
9. **Sugestão de correção:** botão por clipe, ou também "sugerir para a seleção"? (Por clipe, mais "aplicar a todos" com desfazer.)
10. **Posso corrigir a wiki 11** (hoje promete rodas lift/gamma/gain, temperatura/matiz e LUT 3D inexistentes) e acrescentar `CREDITOS_TERCEIROS.md` com a atribuição Apache-2.0 da HeyGen? (Sim, no último commit.)

## 13. Prompt para o chat de implementação

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> Faça depois da frente B (harness de regressão do render): pelo menos o Nível 1 e o cenário `cor_hd_matriz`; sem eles G1 e G3b ficam sem rede de segurança.

---

Quero que o CapIAu Talho exporte HD com a cor certa e etiquetada, trate celular HDR e câmera log (sem WebGL para a parte técnica), sugira correção de cor e ganhe curvas e LUT. Leia antes o plano `G_cor.md` (seções 2, 4, 5, 6 e 8; fica com os outros planos em `docs/plano_hyperframes/`), `.agents/rules/nle-parity-and-media-lifecycle.md` e a docstring de `src/export/video_render/cor.py`. Confira no código cada afirmação; linhas podem ter andado.

### O que já existe (conferido em 28/10/2026)

- Cor do clipe = 7 controles; `cor.py:155-231` traduz o CSS (`player.js:4725-4750`) em 2 `lutrgb` + `colorchannelmixer` + `gblur`; ponto na cadeia: `grafo_video.py:414-416`.
- Export: `comando.py:707-719` não etiqueta nem fixa matriz. Medi com barras SMPTE: lido como Rec.709 dá 29,5 dB; RGB até o fim + `scale=out_color_matrix=bt709` + 4 tags dá 46,6 dB; só o remendo no fim dá 38,6 dB (plano, 4.1).
- Rascunho = proxy, master = original (`midia.py:1-24`); o proxy não tem filtro de cor nem etiqueta (`ffmpeg.py:297-330`); `resolver_fontes` roda depois de montar o grafo (`comando.py:306` e `:666`).
- Detecção só por tag: HLG/PQ sim; V-Log/S-Log/D-Log **não** (`deteccao.py:28-61`); `origem='humano'` é protegida (`media.py:97-113`).
- Só se sondam encoders (`ffmpeg.py:243-271`), nunca filtros. Não existe `.cube`, `lut3d` nem curva no repositório.

### Decisões a confirmar comigo antes de começar (recomendação entre parênteses)

1. Rodar `scripts/medir_cor.py` no meu Edge e no meu ffmpeg e colar o JSON no plano (sim, antes de G1b).
2. Export sempre `bt709`, composição em RGB até uma conversão final (sim; remendo YUV→YUV só se a CPU não aguentar).
3. Fonte sem etiqueta = Rec.709 acima de 576, e proxy etiquetado (sim, após a medição).
4. HDR de celular vira SDR sozinho, com chip desligável (sim).
5. Quais câmeras em log eu uso e se tenho as LUTs oficiais (começar por uma).
6. Proxy regenerado por botão, em fila, por mídia (sim; nunca em lote).
7. LUT criativa só em clipe ao vivo; camada de ajuste depois, via Render Cache (sim).
8. Ordem LUT → 6 funções → temperatura/matiz → curvas → desfoque (sim); posso corrigir a wiki 11 no fim (sim).

### O que fazer (um commit por etapa, em ordem; números e cenários estão no plano, seção 8)

1. **G0** `scripts/medir_cor.py`: SMPTE 709 em 3 etiquetas, página que mede no Edge, `-filters`/`-buildconf`, tempo de proxy. Me peça para rodar.
2. **G1a, G1b** Teste primeiro (`cor_hd_matriz`), depois a correção: matriz e 4 tags no export, `overlay` e `format` em `gbrp`, `in_color_matrix` para fonte sem tag, proxies etiquetados sem recodificar (`h264_metadata`).
3. **G2a–G2c** `src/media/capacidades.py`; transformação técnica por mídia (`video.input_transform`, `proxy_transform_hash`, `FonteClipe.transform_embutida`, fontes resolvidas antes do grafo, `filtro_entrada`, troca atômica do proxy); HDR→SDR (`zscale`/`hable`) no proxy e no master.
4. **G3a, G3b** `src/color/cubo.py`, `LUTS_DIR`, tabela `lut`, importação; `lut3d` técnico (proxy e master), escape de caminho no Windows, "Cor da mídia" na biblioteca com perfil humano.
5. **G4** `src/color/sugestao.py` (`signalstats` no proxy, forma fechada de brilho+contraste, range pc × tv); botão "Sugerir" com antes/depois e desfazer.
6. **G5a–G5c** `curvas.py` (PCHIP, tabela de 256, `lut1d` com +0,5/255), `corFiltro.js` único para os 3 builders, `corSvg.js` com `color-interpolation-filters="sRGB"`, editor de curva, temperatura e matiz por ganho.
7. **G6a** prova de conceito WebGL2: **pare no portão** e me mostre os números (quadros perdidos, `max_abs` contra o export) antes de G6b e G6c.

### Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev` e `docs/HANDOFF_DESIGN_UI.md` (interface: 9–12 px, botões 20–28 px, `var(--fs-N)`, `var(--sp-N)`, `--accent`, nada abre sozinho).
- Outra sessão mexe na interface (`index.html`, `main.js`, `workspaceManager.js`, `styles.css`, `library.js`, `welcomeHub.js`, `player.js` às vezes). Commit só dos seus trechos (índice montado a partir do HEAD), direto na main, sem coautoria, sem push.
- Render ou player: antes de cada commit rode `node tests/autoteste_composicao_multipista_cascata.mjs` e `pytest tests/test_render_composicao_multipista_cascata.py`. Timeline antiga tem de sair com o grafo idêntico.
- CSS do player é a fonte da verdade; `cor.py` traduz. `disabled:true` é ausência. Nada é ignorado em silêncio: o que o motor não faz vira aviso em `fidelidade.py`.
- Windows: ffmpeg 7.1.4 Jellyfin, `C:\…` dentro de `lut3d=file=` exige escape; nenhuma LUT de fabricante entra no repositório. Scripts de edição em arquivo, com `PYTHONUTF8=1`. Servidor de teste `capiau-server-venv` (8022).
- Português, direto. Verifique antes de afirmar; números medidos no sandbox valem como hipótese até rodarem na minha máquina.

### Pronto quando

O export HD sai `bt709` e ≥ 45 dB no `cor_hd_matriz`; o clipe HLG do celular fica igual no rascunho e no master; uma câmera log minha, com a LUT oficial, fica igual nos dois; a sugestão e as curvas funcionam ao vivo e no arquivo (`max_abs` ≤ 2); timelines antigas saem idênticas; o resto de G6 só se o portão passou.
