# Frente C — Legendas a partir da transcrição

> **Resumo.** Entrega: "Gerar legendas da sequência" a partir da tabela `transcript`, em dois modos (clássico de documentário: 42×2, 17 cps, 5/6 a 7 s; dinâmico com karaokê por palavra), com projeção de corte, velocidade e J/L-cut, filtro de alucinação e avisos de qualidade editáveis. Cada legenda é um clipe de texto comum com bloco `legenda`; SRT/VTT/ASS saem por uma rota só.
> Valor: legenda da montagem hoje não existe (SRT/VTT são uma cópia JS de clipes digitados; `subtitles_export.py` está sem chamador).
> Esforço: 9,5 dias úteis (E0 a E5), 12 com karaokê, 16,5 com camada contínua, luminância e casos no harness [inferência].
> Dependências: nenhuma para E1 a E6; E7 espera a D1 (Etapa 3); E9 espera a B.
> Principal risco: escala do render (1 entrada e 2 filtros por legenda; comando longo no Windows; milhares de fotos no karaokê) e custo do desfazer com milhares de clipes.
> Decisão principal: modelo híbrido (clipes de texto + bloco `legenda`), agrupamento em JS puro, exportação só em Python, presets sem fade.
> Pendência: duração mínima/máxima e intervalo da Netflix não foram conferidos (domínio bloqueado nesta sessão).

Marcas: **[lido]** conferido no código · **[inferência]** dedução minha · **[a medir]** precisa de teste prático · **[web: URL]** fonte externa. Caminhos sem prefixo são do Talho (`/home/user/capiau-talho-v03`, estado de 28/10/2026); `HF:` = HyperFrames v0.8.185 (lido, nunca executado). Nomes que eu proponho levam "(novo)". D1 = `D1_navegador.md`; B = `B_regressao_render.md`.

## 1. Objetivo e valor

Gerar, a partir das palavras com tempo que já estão no banco, as legendas **da montagem** (o que se ouve na timeline, com corte, velocidade e J/L-cut projetados), em dois modos:

- **Clássico (documentário):** até 2 linhas de 42 caracteres, até 17 caracteres por segundo, de 5/6 s a 7 s, 2 quadros de intervalo. Estático, sem fade. É o que vai a festival, TV e acessibilidade.
- **Dinâmico (karaokê):** grupos de até 4 palavras, palavra ativa destacada. Para cortes curtos de redes.

O que o Fernando ganha:

1. **Legenda da montagem, hoje inexistente.** SRT/VTT só saem de clipes de texto digitados, por uma cópia em JS no navegador (`panels.js:2528-2563`); `subtitles_export.py` não tem chamador.
2. **Fecha o ciclo da edição por texto (Shift+E):** a transcrição que monta o corte também vira legenda queimada, SRT/VTT/ASS e metadado no OTIO.
3. **Cada legenda é um clipe de texto comum:** mover, aparar, mudar estilo, desligar, desfazer, tudo o que já existe. Nenhum editor novo.
4. **Avisos de qualidade editáveis** (CPS, duração, linhas) e **filtro de alucinação do ASR** que vale também para transcrições já gravadas.

Fora do escopo: tradução; ASR novo (Parakeet é a seção 4.5 da pesquisa); composição HTML (D2); auditoria WCAG completa (H); BeginFrame (D1).

## 2. Estado atual no Talho
### 2.1 O que existe

| Peça | Onde | O que faz ou limita |
|---|---|---|
| Palavras com tempo | `src/db/schema.py:173-181` | `transcript(video_id, word, start_time, end_time, speaker_id, confidence, search_text)`: uma linha por palavra, segundos **da fonte**, falante tipo "Falante A" [lido] |
| Gravação | `src/db/repositories/narrative.py:7-29`, `src/db/operations.py:60`; chamada em `src/transcription/asr_engine.py:225-240` (AssemblyAI, ms para s) e nos demais motores (`motores.py`) | `DELETE` + `INSERT` em lote: regravar apaga a anterior [lido] |
| Leitura | `src/db/repositories/narrative.py:33-42` (palavras), `:45-83` (`get_transcript_dialogues`: agrupa só por falante, sem pausa nem limite), rota `src/api/routes/narrative.py:48-53` (`dialogues` + `words`) | O cliente só guarda as palavras do vídeo ativo (`panels.js:718-720`) [lido] |
| `dialogue_utterance` e `dialogue_word` | `schema.py:515-538` | Modelo de fala sobreposta (canal, `is_overlapping`, palavras ligadas à fala). **Nada em `src/` escreve nem lê**: só `tests/test_ai_layers_2026.py`, `tests/test_adversarial_stress_challenge_2.py`, `tests/test_e2e_talho_2026.py` [lido; grep] |
| Mapa fonte para timeline | `player.js:4016-4062`, `modelo.py:121-125,157-175` | fonte = `in + (t - início)·velocidade`; reverso = `out - …`; `is_freeze` devolve `freeze_time`; `hard_boundaries` trava em [in, out]. Subclipe guarda `parent_video_id` (`player.js:4005`, `timelineState.js:4181-4190`) [lido] |
| Quem soa | `modelo.py:22-28` | P3: só pista `kind == "audio"` soa (o `<video>` é mudo). P4: numa pista vence o primeiro da lista [lido] |
| Clipe de texto | `timelineState.js:4941-4990` (`addTextClip`), `:375,:1343` (pista `kind:"text"`), `textPresets.js:423-463` | `corteParaSalvar` repassa **todos** os campos extras (`timelinePersistencia.js:30-55`) e `save_timeline` grava o JSON como veio (`src/db/repositories/projects.py:141-164`): um bloco `legenda` sobrevive sem tocar o banco [lido] |
| Desenho | `tituloRender.js:15-26,60-139`, `renderTitulos.js:~80-86`, `playerTextOverlay.js:124-162` | Um `<span>` com `clip.text` (`tituloRender.js:~120`); `estadoTitulo` (7 campos) é a chave de dedupe; o preview recria o DOM a cada `sync()` [lido] |
| Render | `titulos.py:89-111,243-253,276-337`, `comando.py:638-662,679-681,723`, `execucao.py:464-470` | **Um `-f concat -i` e 2 filtros por clipe de texto**, `filter_complex` na linha de comando; segmento de até 90 s (`comando.py:74`) e 40 clipes (`:73`) [lido] |
| Export | `src/api/routes/narrative.py:528-531` só `otio\|xml\|edl`; `panels.js:2521-2563` SRT/VTT no navegador (ignora `disabled` e pista oculta); `subtitles_export.py:55-170` SRT/VTT/ASS **sem chamador e sem teste**; `otio_export.py:143-199` `GeneratorReference "Title"` + `metadata["capiau"]` | [lido; grep em `src`, `tests`, `index.html`] |
| Alucinação | `motores.py:463-478` | `repeticao_em_loop`: laço de 1 a 4 palavras repetido 6 vezes. Nada de silêncio final nem de token sem sentido [lido] |
| Desfazer | `timelineState.js:8366-8392` | `_capture()` = `JSON.parse(JSON.stringify(...))` de **todos** os clipes, `limit = 100` [lido] |
| Atalho | `keymapService.js:811`; `index.html:1041` | `Shift+KeyE` = `playback.append_timeline`; a edição por texto está em `wiki/07.-Transcricao-ASR-e-Edicao-por-Texto.md:39` [lido] |

### 2.2 Invariantes que não podem quebrar

1. **Preview e arquivo desenham o título com o mesmo código** (`tituloRender.js`). Legenda não ganha desenho à parte.
2. **Chave de estado:** o que muda o pixel entra em `estadoTitulo`; o que não muda, não. Título sem `legenda` mantém **a mesma chave** (cache de fotos e referências da B intactos).
3. **PNG RGBA com alfa** (a máscara do desfoque lê o alfa, `titulos.py:32-36`). BeginFrame não preserva alfa (D1): não serve a legenda.
4. **Sem navegador o render sai sem títulos e avisa** (`execucao.py:511-522`, `fidelidade.py:215-224`). Vale para legenda queimada; SRT/VTT/ASS não dependem de navegador.
5. P1 a P8 de `modelo.py:17-37`; **cenário canônico multipista** (`tests/autoteste_composicao_multipista_cascata.mjs`, `tests/test_render_composicao_multipista_cascata.py`) verde em toda etapa que toque render ou player.
6. **Tempo em quadros inteiros** (`timelineStartFrame`, `outFrame - inFrame`); legenda quantizada em quadros.
7. Sem tabela nova na v1; `sequence_json` continua `version: 2`; nada baixa sozinho.

### 2.3 Correções à pesquisa anterior (`docs/PESQUISA_HYPERFRAMES.md` §4.2)

| A pesquisa diz | O código mostra |
|---|---|
| "tudo que já existe funciona: edição à mão, SRT/VTT/ASS" | SRT/VTT vêm de uma cópia JS (`panels.js:2528-2563`); o backend recusa o formato (`src/api/routes/narrative.py:530`); `subtitles_export.py` está morto; ASS não tem UI. O export precisa de etapa própria (E5). |
| "Estilos de karaokê entram depois, como preset do Titler" | O Titler desenha um `<span>` só. O preset "Legenda Bounce Dinâmico" (`textPresets.js:~178`) é escala do bloco, não destaque por palavra. Karaokê exige código novo em `tituloRender.js` e na chave de estado (E6). |
| "Grupos de 3 a 5 palavras" | Para documentário a unidade é caractere e tempo (42 por linha, 17 cps, 5/6 a 7 s). Contar palavras vale só no modo dinâmico. O próprio HF diverge: `captions.md` diz 3 a 5 palavras e pausa de 150 ms; o componente usa 4 e 100 ms (`HF:registry/components/caption-pill-karaoke/caption-pill-karaoke.html:144-146`). |
| BeginFrame para "karaokê" (§4.4) | Legenda precisa de alfa; o ganho vem de captura CDP direta e recorte (D1), não de BeginFrame. |
| Luminância escolhe `screen/overlay/normal` | É regra de legenda animada com blend. Legenda de documentário usa contorno e sombra fixos; trocar o estilo por legenda piscaria. Vira aviso opcional (E8). |
| Portar `fitTextFontSize` | Depende de `@chenglou/pretext` e cabe em **uma** linha (`HF:packages/core/src/text/fitTextFontSize.ts:1,36-47`). Aqui são 2 linhas, medidas com `measureText` do Canvas: portar o laço, não a dependência. |

## 3. O que o HyperFrames tem
Apache-2.0 (copyright HeyGen): ao portar constantes ou laços, cabeçalho de atribuição e arquivo marcado como alterado. Nenhum código TypeScript é copiado; portam-se **regras e números**.

| Peça | Onde | Veredito |
|---|---|---|
| Regras de legenda: grupos, pausa, 1 grupo por vez, nada em 0 s, 80 a 120 px da base, área segura de 80 % | `HF:skills/hyperframes/references/captions.md:19-20,35-39` | **Portar as regras** (viram padrões editáveis) |
| Alucinação: descartar palavra que começa em silêncio final (`silencedetect=noise=-35dB:d=0.6`; fala real fica entre -16 e -26 dB); transcrição com > 20 % de `♪`/`�` falhou | `captions.md:8,10` | **Portar** como `alucinacao.py` (novo), com a ressalva da pergunta 6 |
| Associar por posição, nunca por texto | `captions.md:9` | **Portar** (o pseudocódigo guarda índices) |
| `makeGroups`: acumula até 4 palavras e 2 linhas; fecha em pontuação, pausa ou limite | `HF:registry/components/caption-pill-karaoke/caption-pill-karaoke.html:259-297`, constantes `:136-151` | **Adaptar** ao modo dinâmico |
| Karaokê cumulativo: palavra falada fica na cor ativa; grupo fecha em `fim + 0,3 s` sem passar do próximo | mesmo arquivo `:352-380` | **Adaptar** (estado discreto por palavra, sem transição de cor: transição não é "seekável" nem deduplicável) |
| `fitTextFontSize` (78 até 42, passo 2) | `HF:packages/core/src/text/fitTextFontSize.ts` | **Adaptar** o laço com `measureText`; sem `@chenglou/pretext` |
| `splitLinesForGroup` (duas linhas equilibradas) | `caption-pill-karaoke.html:~225-240` | **Inspirar-se**: o clássico prefere pirâmide e quebra sintática, não equilíbrio puro |
| `CaptionStyle`/`CaptionContainerStyle` (cor ativa e apagada, contorno, sombras, brilho, gradiente, `blendMode`) | `HF:packages/studio/src/captions/types.ts:1-207` | **Inspirar-se** nos campos do preset; contorno (`-webkit-text-stroke`) é o único acréscimo útil |
| Componentes `caption-*` (17), `generator.ts`, `store.ts`, `parser.ts` | `HF:registry/components/caption-*`, `HF:packages/studio/src/captions/` | **Não portar:** GSAP pela CDN (licença não OSI; incompatível com o GPLv3 do Talho) e fontes pela CDN do Google; `parser.ts:27-50` agrupa só por contagem (5 palavras) |
| `cli/src/whisper/transcribe.ts` | `HF:packages/cli/src/whisper/` | Fora desta frente (ASR é a §4.5 da pesquisa); não relido aqui |

## 4. Verificações de viabilidade

### 4.1 Projeção fonte para timeline

**Veredito: viável como função pura em JS** (entra com clipes e palavras por vídeo; não toca banco nem DOM), ≈ 1 dia dentro da E1.

| Caso | Regra | Evidência |
|---|---|---|
| De que pista vêm as palavras | Clipes de pistas `kind == "audio"` com `video_id`, não `disabled`, não foto/texto/ajuste/matte. O clipe de vídeo parceiro (`link_id`) **não** conta | `modelo.py:22-25,315`, `player.js:1925` [lido] |
| Parceiro e J/L-cut | Projeta do **clipe de áudio**, com os próprios `in`, `out` e `timelineStartFrame`: o deslocamento J/L já mora nesses campos (`syncOffset` é derivado, `timelineState.js:2566,2598`) | [lido]; [inferência] para "só derivado" |
| Mapa de tempo | `t = timelineStartFrame/fps + (s - in)/v`. Reverso: pula o clipe com aviso. `is_freeze`: sem áudio. Velocidade lida como `modelo.py:451` | `player.js:4016-4040`, `modelo.py:157-175` |
| Subclipe | Transcrição de `parent_video_id ?? video_id`; `in/out` já estão no eixo do arquivo-pai (o piso `subclip_in` é comparado a `cut.in`) | `player.js:4005,4040-4050` [inferência: confirmar com um subclipe real na E1] |
| Pista muda ou oculta | `muted` exclui; `hidden` exclui só com `muteHiddenTracksPlayback` (P7). O diálogo deixa incluir | `modelo.py:33-34`, `playerTextOverlay.js:~94` |
| Palavra cortada na borda | Fica se ≥ 50 % da duração cai em [in, out] (tolerância 40 ms), com tempos aparados; senão sai. Meia sílaba não se lê | [inferência; regra minha, editável] |
| Sobreposição na mesma pista | P4: a palavra pertence ao clipe que vence no seu ponto médio (primeiro da lista) | `modelo.py:26-28,504` |
| Falas sobrepostas | Ordena por tempo; troca de falante abre cue novo; cues que se sobrepõem em mais de 1 quadro vão para a pista "Legendas 2" (partição gulosa de intervalos) | [inferência] |
| Mesmo áudio em 2 pistas | Deduplica por `(video_id, início na fonte ± 1 quadro, t ± 1 quadro)` | [inferência] |

### 4.2 Os dois modos

**Veredito: viável.** O clássico é original (o HF não tem) e concentra a lógica linguística; o dinâmico adapta o HF.

**(a) Clássico, números do guia da Netflix.** O host `backlothelp.netflix.com` não resolve nesta sessão (fora da lista de domínios); só li o resultado da busca. O que ficou comprovado e o que não:

| Parâmetro | Padrão | Fonte |
|---|---|---|
| Caracteres por linha | 42 | [web: https://backlothelp.netflix.com/hc/en-us/articles/215600497-Portuguese-Brazil-Timed-Text-Style-Guide] (trecho da busca) |
| Velocidade de leitura | 17 cps adulto (≈ 200 palavras/min); 13 cps infantil | [web: https://backlothelp.netflix.com/hc/en-us/articles/216787938-Portuguese-Timed-Text-Style-Guide], guia "Portuguese" geral; **a conferir no do Brasil** |
| Linhas, duração mínima (5/6 s = 20 quadros a 24 fps), máxima (7 s), intervalo (2 quadros), quebra em pirâmide e sintática | 2 · 0,83 s · 7 s · 2 quadros | [inferência: guia geral lido de memória, **não conferido**] |

Todos viram chaves de Configurações (§6); nenhum número é fixo no código. Pergunta 11: liberar o domínio ou o Fernando conferir.

**(b) Dinâmico, regras do HF:** até 4 palavras e 2 linhas; fecha em `[,.:!?]`, pausa ≥ 0,15 s (referência; o componente usa 0,10 s) ou troca de falante; grupo abre 0,05 s antes da 1ª palavra e fecha em `fim + 0,3 s` sem passar do próximo grupo; primeira legenda nunca em 0 s (0,1 s); tamanho base 72 e piso 52, passo 2; associação por posição.

**Pseudocódigo do clássico** (`legendaAgrupamento.js`, novo):

```
agruparClassico(pal, R):   // pal em segundos da TIMELINE, ordenadas; R = regras (cpl 42, linhas 2, cps 17, durMin, durMax 7, pausaDura 0,8, preRoll, posRoll)
  pal = colarPontuacao(semSentido(pal))           // "." solto cola na anterior; "♪", "�" e vazios saem
  para cada w (índice i), cur = lista corrente:
    se cur != [] e (w.falante != ultimo(cur).falante ou w.ini - ultimo(cur).fim >= R.pausaDura): fechar(cur)
    cand = cur + [w]; linhas = quebrarLinhas(texto(cand), R.cpl, R.linhas)      // null se não cabe
    dur = (w.fim + R.posRoll) - (cand[0].ini - R.preRoll)
    se cur != [] e (linhas == null ou dur > R.durMax ou cps(texto(cand), dur) > R.cps):
        k = melhorQuebra(cur)       // dentre as 3 últimas posições: após pontuação > antes de conjunção/preposição > resto; nunca separa artigo+substantivo
        fechar(cur[0..k]); cur = cur[k..] + [w]
    senão cur = cand
    se w termina em .?!… e duracao(cur) >= 1,0 s: fechar(cur)
    senão se w termina em ,;: e chars(cur) >= 0,6·cpl·linhas e duracao(cur) >= 1,5 s: fechar(cur)
  para cada cue c, em ordem:       // tempos só depois de agrupar
    c.ini = quadro(c.pal[0].ini - R.preRoll);  c.fim = quadro(ultima(c.pal).fim + R.posRoll)
    c.fim = max(c.fim, c.ini + R.durMin)                       // estende até 5/6 s
    se há próximo: c.fim = min(c.fim, proximo.ini - R.intervalo)   // 2 quadros
    c.avisos = avaliar(c)          // CPS, DUR_CURTA, DUR_LONGA, LINHAS, CPL; nunca inventa tempo para esconder aviso
quebrarLinhas(txt, cpl, n): 1 linha se couber; senão testa cada espaço, exige todas as linhas <= cpl, pontua (pontuação > conjunção > resto; pirâmide: linha de baixo >= a de cima), devolve a melhor ou null
```

**Pseudocódigo do dinâmico:**

```
agruparDinamico(pal, R):   // R: maxPal 4, pausa 0,15, bufferFim 0,3, avanço 0,05, tamBase 72, tamMin 52, medir(txt, tam) -> px
  para cada w (índice i), g = grupo corrente (guarda ÍNDICES, nunca compara texto):
    se g != [] e (len(g) + 1 > R.maxPal ou !cabeEmDuasLinhas(g + [w], R.tamBase, R.larguraMax)): fechar(g); g = []
    g.push(w)
    se len(g) >= R.maxPal ou i é a última ou termina em [,.:!?] ou pal[i+1].ini - w.fim >= R.pausa ou muda o falante: fechar(g); g = []
  para cada grupo G, em ordem:
    G.ini = max(G.pal[0].ini - R.avanço, 0,1);  G.fim = min(ultima(G.pal).fim + R.bufferFim, proximo.ini - 1 quadro)
    G.tam = maior s em {tamBase, tamBase-2, …, tamMin} que cabe em 2 linhas
    cada palavra: i = ini - G.ini; f = fim - G.ini          // relativas ao início do clipe
  // estado da palavra no instante u (relativo): ativa = máx j com pal[j].i <= u (cumulativo)
```

### 4.3 Modelo de dados

**Veredito: híbrido** (clipes de texto comuns, com bloco `legenda`). Comparação completa na §5.1; razões decisivas: tudo que o Fernando já usa (mover, aparar, estilo, desligar, desfazer, duplo clique para editar) funciona sem código novo, e o render já entende clipes de texto.

Evidências que pesam na escolha:

- **Render por clipe:** cada clipe de texto vira 1 entrada `-f concat` e 2 filtros (`comando.py:638-662,679-681`), ≈ 275 caracteres de linha de comando [inferência: soma dos formatos do código; a medir]. O `CreateProcess` do Windows aceita 32 767 [inferência: conhecimento do sistema, não conferido aqui]. Com segmento de 90 s (`comando.py:74`): clássico ≈ 29 clipes por segmento (≈ 8 KB), dinâmico ≈ 63 (≈ 17 KB). Cabe, com pouca folga se o Fernando aumentar `render.segment_max_seconds`. Se a E0 passar de 24 KB, entra a camada contínua (E7).
- **Cache de fotos:** `titulos.py` nomeia a pasta por `_hash(clipe, largura, altura)`; o clipe inclui `id`, `timeline_start` e `track`. Mover uma legenda ou regenerar depois de remontar refaz todas as fotos com pixels iguais. Precisa de **chave visual** (só campos que mudam o pixel), na E3.
- **Desfazer:** `_capture()` copia todos os clipes. 600 legendas × ≈ 1,3 KB ≈ 0,8 MB por passo (≈ 80 MB em 100 níveis); uma hora de fala contínua (≈ 1 140 clássicas, ≈ 2 500 dinâmicas) passa de 3 MB por passo [inferência]. Meta: `_capture` ≤ 40 ms com 600 legendas [a medir]. Por isso `palavras` só existe no modo dinâmico.
- **Edição manual:** duplo clique (`playerTextOverlay.js:479`) e painel do Titler já alteram o clipe; o ponto de edição de texto marca `legenda.editada = true` (localizar na E3). **Karaokê** e **export** estão em 4.4 e §6.3.

### 4.4 Karaokê no Titler e custo em fotos

**Veredito: hoje não suporta; viável com mudança pequena e localizada** (E6, ≈ 2,5 d). Evidência: `tituloRender.js:~120` faz `textContent = clip.text` num único `<span>`; `estadoTitulo` (`:15-26`) não tem índice de palavra; `renderTitulos.js:~80-86` usa `JSON.stringify(estadoTitulo)` como chave de dedupe.

Mudança: com `clip.legenda.modo === "dinamica"`, `montarElementoTitulo` divide `clip.text` em palavras (preservando espaços e `\n`) e embrulha cada uma em `<span class="leg-pal">`, cor ativa até o índice ativo e cor apagada depois; `estadoTitulo` ganha `palavra` **só nesse caso**, então as chaves de títulos comuns não mudam. Se o texto foi editado e o número de palavras difere de `palavras`, os tempos se redistribuem por número de caracteres.

Estados e fotos por minuto de vídeo (fala de 150 palavras/min [inferência]; custo por foto de título esparso: 40 a 120 ms, estimativa da D1 §4.5 [a medir]):

| Modo | Estados/min | Fotos/min | Tempo/min de vídeo | Uma hora |
|---|---:|---:|---:|---:|
| Clássico sem fade | ≈ 19 | 19 | 0,8 a 2,3 s | 46 a 137 s |
| Clássico, fade de 4 quadros | ≈ 171 | 171 | 7 a 21 s | 7 a 20 min |
| Dinâmico sem fade (1 por palavra) | ≈ 150 | 150 | 6 a 18 s | 6 a 18 min |
| Dinâmico, fade de 3 quadros | ≈ 375 | 375 | 15 a 45 s | 15 a 45 min |

Recomendação: **presets sem fade**; fade de 2 quadros é opção. A segunda exportação reaproveita o cache; a D1 (CDP direto, recorte) reduz o custo por foto sem mexer em pixels.

### 4.5 Legibilidade pela luminância

**Veredito: viável como aviso opcional (E8), não como automação.** Método: um `ffmpeg` por arquivo-fonte usado, no proxy (`proxy_vid_<id>.mp4`), `-ss/-to` da faixa usada e `-an -f null -` com `fps=2,crop=iw*0.8:ih*0.2:iw*0.1:ih*0.72,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`; cada legenda toma a mediana das amostras da sua janela (tempo da fonte). Limiares do HF: < 60, 60 a 180, > 180 (`captions.md:38`).

- **Custo [a medir]:** decodificar o proxy ≈ duração usada ÷ 20 a 40, ou seja 15 a 30 s por 10 min usados. Um processo por legenda (`-ss` antes de `-i`, 1 quadro) ≈ 80 a 150 ms cada, 15 a 30 s para 190 legendas. Escolho a passagem única.
- **Limite:** mede a **fonte**, não o quadro composto (ajuste, outras pistas, cor, blend) [inferência]. A frente H mede o composto; C só consome o resultado se H existir.
- **Uso:** aviso "N legendas sobre fundo claro" e botão "aplicar faixa a estas". Sem troca automática: estilo mudando legenda a legenda pisca.

### 4.6 Filtro de alucinação

**Veredito: viável, e vale para transcrições já gravadas**, porque roda na **leitura** (ao gerar a legenda); `save_transcript_words` e o ASR não mudam.

- **Onde:** `src/transcription/alucinacao.py` (novo), funções puras: `tokens_sem_sentido` (> 20 % de `♪`, `�` ou sem letra), `em_silencio_final(palavras, silencios, duracao_s)`; reusa `repeticao_em_loop` (`motores.py:463`). `src/services/legendas_fonte.py` (novo) lê `transcript`, roda `silencedetect=noise=-35dB:d=0.6` **só nos últimos 60 s** do arquivo (`-ss duração-60`) e devolve `{palavras, suspeitas:[{indice, motivo}], falhou}` pela rota `POST /api/legendas/fonte` (novo).
- **Regra:** palavra que começa num silêncio que **chega ao fim do arquivo** (`silence_start` sem `silence_end`, ou com fim a menos de 0,3 s da duração) sai por padrão e aparece na prévia, reversível. Silêncio no meio só **marca**: fala baixa existe e se perderia (o HF só trata o final).
- **Falha:** > 20 % de tokens sem sentido: o diálogo recusa o vídeo e oferece "gerar assim mesmo".
- **Custo e teste [a medir]:** ≈ 0,3 a 1 s por arquivo. Teste sintético: tom (fala) + 20 s de silêncio + "Obrigado." sai; fala a -24 dB fica. Limite: precisa do arquivo (original, ou proxy com áudio).

### 4.7 Interface

**Veredito: viável, dentro do padrão existente.**

| Peça | Onde | Detalhe |
|---|---|---|
| Comando | Aba Títulos (`titlesTab.js`, seção "Legendas da transcrição"); menu de contexto da timeline (`timelineInteraction.js:~3594-3700`); atalho `Alt+Shift+KeyL` (`legendas.gerar`, novo) | `grep -c` em `keymapService.js`: `Alt+Shift+KeyL`, `Ctrl+Alt+KeyC`, `Ctrl+Alt+KeyG`, `Ctrl+Shift+KeyL` = 0 (livres); em uso: `Ctrl+Alt+KeyL`, `Alt+KeyG`, `Alt+Shift+KeyG`, `Alt+KeyT`. `Shift+KeyE` é `append_timeline`. Evitar `Ctrl+Alt` (AltGr no ABNT2) |
| Diálogo | Modal no padrão do de exportação (`index.html:~1985-2005`, `panels.js:~2415`), `legendasUI.js` (novo) | Pistas de áudio, modo, preset, faixa (tudo ou IN-OUT), limites, filtro de alucinação, "substituir" ou "preservar editadas" |
| Prévia | Tabela: início, texto, CPS colorido, avisos; clique move a agulha | Sem sobreposição ao vivo no Program na v1; "Aplicar" cria tudo numa transação; Ctrl+Z desfaz |
| Progresso | Texto no diálogo ("Lendo transcrições 3/5") | Luminância (> 5 s) usa `TASK_MANAGER`, como as outras tarefas |
| Avisos | Lista "Legendas com aviso" e selo no clipe (`timelineRenderer.js`) | Limites editáveis no diálogo e em Configurações; botões "estender" e "dividir" |

## 5. Decisões de projeto
### 5.1 Modelo de dados

| Alternativa | Edição manual | Regenerar | Karaokê | Render | Export | Veredito |
|---|---|---|---|---|---|---|
| A. Clipes de texto numa pista, sem metadado | Total | Não distingue o gerado do digitado | Sem palavras | 1 entrada por clipe | SRT mistura GCs | Rejeitada |
| B. Objeto único com todas as legendas | Só por editor novo; não aparar nem mover uma legenda | Trivial | Fácil | 1 entrada | Simples | Rejeitada: perde as ferramentas da timeline |
| **C. Híbrido: clipes de texto + bloco `legenda`** | Total, com desfazer | Por `legenda.chave`, `editada` | `palavras` no bloco | 1 entrada por clipe; camada contínua opcional (E7) | Filtra por `legenda` | **Recomendada** |

### 5.2 Demais decisões

| Decisão | Alternativas | Recomendação | Por quê |
|---|---|---|---|
| Onde agrupar | JS puro / Python | **JS puro** (`legendaAgrupamento.js`, medida de texto injetada) | Mede com a fonte do preset; testa em Node; Python só serve palavras limpas e exporta |
| Regenerar | Substituir tudo / preservar editadas / diff | **Preservar editadas**: as palavras de legendas `editada` saem do fluxo; se a fonte sumiu, a legenda fica marcada "órfã" | Nunca perde trabalho manual; Ctrl+Z cobre o resto |
| Pista | Reusar T1 / nova | **Pista "Legendas"** (`kind:"text"`), "Legendas 2" só se houver sobreposição | Trava, esconde e exporta separado dos GCs |
| Estilo do clássico | Contorno e sombra / caixa translúcida | **Contorno e sombra, sem caixa**, como `subtitle_cinema_dialogue` (`textPresets.js:121-146`); caixa só pelo aviso de luminância | Sem `backdrop-filter` não há máscara de desfoque por legenda no render |
| Âncora | Centro (hoje) / base | **Base** (`legenda.ancora = "baixo"`: `translate(-50%, -100%)`) | Com centro, 1 e 2 linhas têm bases diferentes e a legenda "pula" |
| Fade | Com / sem | **Sem fade** (corte seco) | 19 contra 171 fotos por minuto (4.4); é o padrão de documentário |
| Tamanho | Fixo / por grupo | Clássico **fixo** por altura de quadro (44 px a 1080); dinâmico **por grupo** (72 até 52) | Legenda que muda de tamanho distrai em documentário |
| Export | JS + Python / só Python | **Só Python**, uma rota (`export/srt\|vtt\|ass`) | Hoje há duas cópias divergentes (§2.1) |
| Camada contínua | Sempre / nunca / se medir | **Só se a E0 medir > 24 KB de comando** | Evita mexer em `titulos.py` sem necessidade |
| Alucinação | Na gravação / na leitura | **Na leitura** | Cobre o que já está gravado |

## 6. Modelo de dados e compatibilidade

### 6.1 Clipe de legenda no `sequence_json` v2

Um clipe de texto comum (`addTextClip`, `timelineState.js:4941`) com um bloco `legenda` (campos de estilo omitidos do exemplo):

```json
{ "id": "leg_1730000000_0007", "type": "text", "track": "T2", "textCategory": "subtitle", "presetId": "subtitle_documentario",
  "text": "Eu cheguei aqui em 1982\ne nunca mais saí.", "timeline_start": 12.5, "in": 0, "out": 3.25, "link_id": null,
  "legenda": { "v": 1, "modo": "classica", "ancora": "baixo",
    "fonte": { "video_id": 12, "ini_s": 83.20, "fim_s": 86.45, "falante": "Falante A" },
    "chave": "12:83200:86450", "editada": false, "gerada_em": "2026-10-28T14:00:00Z",
    "regras": { "cpl": 42, "linhas": 2, "cps": 17 },
    "palavras": [ { "t": "Eu", "i": 0.00, "f": 0.18 } ],
    "cores": { "ativa": "#facc15", "apagada": "#ffffffb3" } } }
```

`palavras` (tempos relativos ao início do clipe, em segundos da timeline) e `cores` existem **só no modo `dinamica`**. `chave` é `video_id:início_ms:fim_ms` na **fonte**: sobrevive a mover e remontar.

### 6.2 Compatibilidade

| Aspecto | Regra |
|---|---|
| Versão | `sequence_json.version` continua 2; `legenda.v` evolui sozinho. Nenhuma tabela nem coluna nova na v1 |
| Fonte das palavras | `transcript`. `dialogue_utterance/dialogue_word` ficam como extensão: se alguém passar a gravá-las, `legendas_fonte.py` prefere `dialogue_word` nos trechos de fala sobreposta |
| Timelines antigas | Sem `legenda`, nada muda; "Gerar legendas" nunca toca clipe sem `legenda`. Timeline com legendas aberta em versão anterior: `corteDoBanco` repassa o campo (`{...c}`), o render a trata como título comum e o dinâmico degrada para texto de cor única |
| Python | `modelo._clipe` já guarda o clipe de texto inteiro em `bruto` (`modelo.py:~473`); `legenda` chega ao navegador sem mudar o contrato congelado. `titulos.py` passa a nomear a pasta de fotos por **chave visual**: exclui `id`, `timeline_start`, `timelineStartFrame`, `track`, `link_id`, `in`, `out`, `inFrame`, `outFrame` e `legenda.{fonte,chave,gerada_em,editada}`. Invalida o cache uma vez |
| Configurações | `legendas.*` em `settings_registry.py` (categoria `timeline`, nível `pro`, escopo `global`, `requires_reprocess: False`): `max_cpl` 42, `max_linhas` 2, `max_cps` 17, `dur_min_s` 0,83, `dur_max_s` 7, `intervalo_quadros` 2, `pausa_dura_s` 0,8, `pre_roll_s` 0,08, `pos_roll_s` 0,25, `dinamico_max_palavras` 4, `dinamico_pausa_s` 0,15, `filtrar_alucinacao` verdadeiro, `silencio_db` -35, `silencio_min_s` 0,6, `preset_classico`, `preset_dinamico`, `srt_ao_lado` |
| Regras do clipe x Configurações | O clipe grava as regras usadas (`legenda.regras`): mudar Configurações não altera legendas prontas. "Reavaliar avisos" usa as do clipe ou as atuais, à escolha |

### 6.3 Exportação

Uma rota (`GET /api/timeline/{id}/export/{srt|vtt|ass}?somente_legendas=1`, estende `src/api/routes/narrative.py:530`), lendo o `sequence_json` salvo.

| Formato | Conteúdo |
|---|---|
| SRT | Clipes com `legenda` (se não houver, todos os textos, como hoje), ordenados; sem `disabled`; sem pista oculta; `\n` do texto vira quebra; fim = início + (out - in) |
| VTT | Idem; no dinâmico, opção "tempo por palavra" (`<00:00:12.500>`); escapa `&`, `<` e `-->` |
| ASS | `PlayRes` = tamanho da sequência (px do quadro = `PlayResY`); um `Style` por preset (fonte, tamanho, contorno, `Alignment 2`, `MarginV` da âncora); no dinâmico, `{\k<cs>}` por palavra |
| OTIO | `GeneratorReference "Title"` como hoje (`otio_export.py:143-199`) + `metadata["capiau"]["legenda"]`; pista "Legendas". Com `srt_ao_lado`, grava `<nome>_legendas.srt` junto, como já se faz com o relatório de efeitos (`narrative.py:~540-553`) |
| XML, EDL | Sem mudança |

## 7. Mudanças por arquivo

| Arquivo | Ação | O quê | Etapa |
|---|---|---|---|
| `src/ui/js/legendaProjecao.js` (novo) | criar | `projetarPalavras`: P3/P4, mapa de tempo, borda 50 %, dedupe, pistas | E1 |
| `src/ui/js/legendaAgrupamento.js` (novo) | criar | `agruparClassico`, `quebrarLinhas`, `agruparDinamico` (E6); medida de texto injetada | E1, E6 |
| `src/ui/js/legendaAvisos.js` (novo) | criar | `avaliarCue`: CPS, duração, linhas, caracteres, intervalo | E1 |
| `src/ui/js/legendaClipes.js` (novo) | criar | `cuesParaClipes`, `mesclarRegeneracao` (fixadas, órfãs) | E3 |
| `src/ui/js/legendasUI.js` (novo) | criar | Diálogo, prévia, avisos, chamada à API | E4 |
| `src/ui/js/timelineState.js` | alterar | `addTextClips(lote)` em uma transação do `TIMELINE_HISTORY`; pista "Legendas"; marcar `editada` | E3 |
| `src/ui/js/tituloRender.js` | alterar | Âncora de base (E3); palavras e `estadoTitulo.palavra` só no dinâmico (E6) | E3, E6 |
| `src/ui/js/textPresets.js` | alterar | `subtitle_documentario` (E3), `subtitle_dinamica_palavra` (E6) | E3, E6 |
| `src/ui/js/titlesTab.js`, `timelineInteraction.js`, `timelineRenderer.js`, `keymapService.js`, `api.js` | alterar | Seção Legendas; menu de contexto; selo de aviso; `legendas.gerar` (`Alt+Shift+KeyL`); `fetchLegendasFonte` | E4 |
| `src/ui/index.html` | alterar | Modal (a outra sessão mexe aqui: commit só dos meus trechos) | E4 |
| `src/ui/js/panels.js` | alterar | Remove a cópia SRT/VTT (`:2521-2563`); botão chama a rota | E5 |
| `src/transcription/alucinacao.py` (novo) | criar | `tokens_sem_sentido`, `em_silencio_final`, `avaliar_transcricao` | E2 |
| `src/services/legendas_fonte.py` (novo) | criar | Lê `transcript`, `silencedetect` nos últimos 60 s, devolve palavras e suspeitas | E2 |
| `src/api/routes/narrative.py` | alterar | `POST /api/legendas/fonte` (novo); `export/{fmt}` aceita srt, vtt, ass | E2, E5 |
| `src/export/subtitles_export.py` | reescrever | Filtro `legenda`, pista oculta, VTT/ASS por palavra, testes | E5 |
| `src/export/otio_export.py` | alterar | `metadata["capiau"]["legenda"]`, `srt_ao_lado` | E5 |
| `src/services/settings_registry.py` | alterar | Chaves `legendas.*` | E4 |
| `src/export/video_render/titulos.py` | alterar | Chave visual da pasta de fotos (E3); gancho da camada contínua (E7) | E3, E7 |
| `src/export/video_render/legendas.py` (novo) | criar | Uma entrada ffconcat contínua por pista de legenda, com quadro transparente nos vazios | E7 (condicional) |
| `tests/autoteste_legenda_{projecao,agrupamento,avisos,clipes}.mjs` (novos), `tests/autoteste_titulo_render.mjs` | criar, ampliar | §9 | E1, E3, E6 |
| `tests/test_{alucinacao,legendas_fonte,legenda_export}.py` (novos), `tests/test_render_titulos.py`, `tests/test_render_legendas.py` (novo) | criar, ampliar | §9 | E2, E3, E5, E7 |
| `tests/render_regressao/cenarios/legenda_*.json` (da B) | criar | 4 casos (§8, E9) | E9 |
| `docs/PESQUISA_HYPERFRAMES.md` | alterar | Nota na §4.2 apontando as correções da §2.3 | E5 |

## 8. Etapas

Um commit por etapa, mensagem em português (conventional commits), pytest em `tests/test_*.py`, autotestes Node ESM com DOM falso em `tests/autoteste_*.mjs`. Etapas que tocam render ou player (E3, E6, E7) rodam antes o cenário canônico: `node tests/autoteste_composicao_multipista_cascata.mjs` e `pytest tests/test_render_composicao_multipista_cascata.py`.

| Etapa | Commit | Conteúdo | Testes | Dias | Dep. |
|---|---|---|---|---:|---|
| E0 | `test(legendas): script de medição de foto, comando e desfazer` | `scripts/legendas_medir.py` (novo): 70 clipes sintéticos; ms por foto (p50, p90) e por `preparar`; tamanho do `cmd` de `montar_comando` com fotos falsas; `_capture` do histórico com 600 e 2 700 clipes (Node). Saída colada na §9 | Nenhum de regressão; é a base das metas | 0,5 | nenhuma |
| E1 | `feat(legendas): projeção da transcrição na timeline e agrupamento clássico` | `legendaProjecao.js`, `legendaAgrupamento.js` (clássico e `quebrarLinhas`), `legendaAvisos.js`; regras de PT-BR em tabela de dados (conjunções, preposições, artigos) | `autoteste_legenda_projecao.mjs` (12 casos de 4.1), `autoteste_legenda_agrupamento.mjs` (propriedades + golden), `autoteste_legenda_avisos.mjs` | 2,5 | nenhuma |
| E2 | `feat(legendas): palavras da transcrição pelo servidor com filtro de alucinação` | `alucinacao.py`, `legendas_fonte.py`, `POST /api/legendas/fonte` | `test_alucinacao.py` (tom + 20 s de silêncio + "Obrigado."), `test_legendas_fonte.py` (banco temporário via `CAPIAU_DB_PATH`, `src/config.py:109`) | 1,5 | nenhuma (paralela à E1) |
| E3 | `feat(legendas): legendas viram clipes de texto numa pista própria` | `legendaClipes.js`; `addTextClips` em uma transação; pista "Legendas"; preset clássico; âncora de base; chave visual de cache; marca `editada` | `autoteste_legenda_clipes.mjs` (uma transação, Ctrl+Z, fixadas e órfãs), `autoteste_titulo_render.mjs`, `test_render_titulos.py` (mover legenda não refaz fotos) + canônico | 1,5 | E1 |
| E4 | `feat(legendas): diálogo Gerar legendas, avisos de qualidade e atalho` | Modal, seção na aba Títulos, menu de contexto, selo no clipe, `Alt+Shift+KeyL`, chaves `legendas.*`, `fetchLegendasFonte` | `autoteste_legenda_clipes.mjs` (fluxo do diálogo com DOM falso), teste do registro de Configurações | 2 | E2, E3 |
| E5 | `feat(export): SRT, VTT e ASS pela rota única, só das legendas` | Reescreve `subtitles_export.py`; rota `export/{srt\|vtt\|ass}`; some a cópia JS; `metadata.capiau.legenda` e `srt_ao_lado` no OTIO; nota na pesquisa | `test_legenda_export.py` (golden byte a byte; `ffmpeg -i` abre SRT/VTT/ASS; soma dos `\k`) | 1,5 | E3 |
| E6 | `feat(titulos): karaokê por palavra e agrupamento dinâmico` | `agruparDinamico`; palavras e `estadoTitulo.palavra` em `tituloRender.js`; preset `subtitle_dinamica_palavra` | `autoteste_legenda_agrupamento.mjs`, `autoteste_titulo_render.mjs` (4 estados por grupo; chave de título comum idêntica), `test_render_titulos.py` (navegador real; `skip` sem ele) + canônico | 2,5 | E1, E3 |
| E7 | `perf(render): camada contínua de legendas` (**só se a E0 passar de 24 KB de comando ou 150 ms por foto**) | `legendas.py` (novo): 1 entrada ffconcat por pista de legenda, quadro transparente nos vazios; gancho em `preparar_titulos` | `test_render_legendas.py`: saída com clipes separados == camada contínua (`max_abs` 0); `cmd` < 24 000 caracteres com 120 legendas + canônico | 2 | E0, E3, D1 Etapa 3 |
| E8 | `feat(legendas): aviso de legibilidade pela luminância da fonte` (opcional) | Passagem única `signalstats` no proxy, mediana por legenda, aviso e "aplicar faixa" | `test_legendas_luminancia.py` (vídeo sintético claro e escuro) | 1,5 | E4 |
| E9 | `test(render): casos de legenda no harness de regressão` | Casos da B: `legenda_classica`, `legenda_karaoke`, `legenda_sincronia`, `legenda_camada_continua` (se E7) | Os próprios (ver §9) | 1 | B Etapas 1 a 6 e 11, E3, E6 |

**Total [inferência; estimativa grossa]:** mínimo E0 a E5 = **9,5 dias**; com karaokê (E6) = **12**; completo (E7 a E9) = **16,5**. Ordem: E0, E1 em paralelo com E2, E3, E4, E5, E6, depois o que a medição pedir. D1 e B não bloqueiam E1 a E6.

## 9. Testes e medições

| # | Medida | Alvo | Como |
|---:|---|---|---|
| 1 | Projeção | 0 divergências em 12 casos: 0,5x, 2x, reverso, freeze, J-cut, L-cut, subclipe, P4, borda 50 %, pista muda/oculta, `disabled`, duplicado | `autoteste_legenda_projecao.mjs` |
| 2 | Conservação | Cada palavra aceita aparece em exatamente 1 cue, na ordem (1 000 fluxos aleatórios, semente fixa) | `autoteste_legenda_agrupamento.mjs` |
| 3 | Regras do clássico | Em 1 000 fluxos: linhas ≤ 2, cada ≤ 42, duração ≤ 7 s, intervalo ≥ 2 quadros; todo cue com CPS > 17 ou duração < 5/6 s **tem aviso** | idem |
| 4 | Golden PT-BR | 3 trechos reais do Fernando; mudança só com aprovação explícita | idem |
| 5 | Desempenho do módulo | 10 000 palavras (≈ 66 min de fala): projeção + clássico ≤ 300 ms em Node; dinâmico com `measureText` ≤ 1,5 s no Edge [a medir] | script da E0 |
| 6 | Alucinação | 4 casos sintéticos 100 % corretos (silêncio final, fala a -24 dB, silêncio no meio só marca, > 20 % de `♪`); ≤ 1 s por arquivo | `test_alucinacao.py` |
| 7 | Chave de estado | Título sem `legenda`: `JSON.stringify(estadoTitulo)` idêntico ao anterior em todos os 15 presets; dinâmico: 4 estados distintos num grupo de 4 palavras sem fade | `autoteste_titulo_render.mjs` |
| 8 | Fotos | p50 ≤ 120 ms por foto (1080p, antes da D1); 1 h de clássico ≤ 2,5 min de fotos; segunda exportação 0 fotos novas; mover legenda 0 fotos novas | E0 e `test_render_titulos.py` |
| 9 | Comando | 63 legendas (dinâmico, 90 s): `cmd` < 24 000 caracteres, senão E7 | E0 |
| 10 | Desfazer | `_capture` ≤ 40 ms com 600 legendas; 1 Ctrl+Z remove a geração inteira | E0 e `autoteste_legenda_clipes.mjs` |
| 11 | Paridade (B) | `legenda_classica` e `legenda_karaoke`: ≥ 50 dB contra a referência; Nível 2: erro médio < 3, como o cenário 17 (`titulo_caixa_desfoque`, B §4.6) | harness da B |
| 12 | Sincronia ponta a ponta | `legenda_sincronia`: sequência com pulsos de tom em tempos conhecidos da fonte, 2x e J-cut; início do pulso (áudio do export) contra o 1º quadro da legenda: \|Δ\| ≤ `pre_roll` + 1 quadro | B (oráculos de áudio e de quadro) |
| 13 | Export | SRT/VTT/ASS byte a byte contra golden; `ffmpeg -i` abre os três; soma dos `\k` = duração do cue ± 1 cs | `test_legenda_export.py` |

Casos que a C acrescenta ao harness da B (`tests/render_regressao/cenarios/`, `schema: 1`, `sequencia` = `sequence_json` v2, marcador `needs_browser`): `legenda_classica` (3 legendas: 1 linha, 2 linhas, base alinhada), `legenda_karaoke` (grupo de 4 palavras, amostra de cor por palavra), `legenda_sincronia`, `legenda_camada_continua` (metamórfico: bypass da E7 == clipes separados). Cada um nasce `xfail(strict)` apontando a etapa, como a B manda.

## 10. Critérios de aceite

1. **Sincronia:** numa sequência multipista com J-cut e clipe a 2x, cada legenda aparece no tempo da fala dentro de `pre_roll` + 1 quadro (caso `legenda_sincronia`).
2. **Clássico:** 100 % das legendas cumprem 42 por linha, 2 linhas, 5/6 s a 7 s e 2 quadros de intervalo, **ou** têm aviso visível; CPS acima do limite sempre tem aviso.
3. **Dinâmico:** até 4 palavras por grupo, destaque cumulativo, palavra ativa trocando no quadro certo (± 1 quadro) no arquivo exportado.
4. **Preview = arquivo** para os dois presets, nas medidas da B (≥ 50 dB; erro médio < 3 no Nível 2).
5. **Edição:** toda legenda se move, apara, restila, desliga e edita com as ferramentas atuais; um Ctrl+Z desfaz a geração inteira; regenerar preserva as editadas e marca as órfãs.
6. **Alucinação:** em transcrição **já gravada**, "Obrigado." sobre o silêncio final sai e fala a -24 dB fica; as palavras removidas aparecem na prévia.
7. **Export:** SRT, VTT e ASS saem por uma rota só, por padrão só das legendas; a cópia JS de `panels.js` deixa de existir; os três abrem no `ffmpeg`.
8. **Sem regressão:** título sem `legenda` tem pixels e chaves de cache idênticos; cenário canônico verde em E3, E6 e E7.
9. **Sem navegador:** a legenda queimada some com o aviso de sempre; SRT, VTT e ASS continuam saindo.
10. **Compatibilidade:** nenhuma tabela nova; a timeline salva abre na versão anterior sem erro.
11. **Medido:** os números da E0 estão na §9 e as metas valem, ou a divergência está justificada no commit.

## 11. Riscos e mitigação

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Tempos das palavras do ASR imprecisos (± 100 a 300 ms) deixam a legenda fora do ritmo | média | médio | `pre_roll`/`pos_roll` editáveis; "deslocar todas" ± N quadros no diálogo; calibrar com os gabaritos (`docs/proximos_chats/06`) |
| Quebra de linha em português com cara de máquina | alta | médio | Regras em tabela de dados; golden com amostras reais; edição manual |
| **Render: 1 entrada e 2 filtros por legenda**; comando longo no Windows | média | alto | Medir na E0 (meta < 24 000 caracteres); segmento de 90 s já limita; E7 se passar |
| Karaokê com milhares de fotos | média | médio | Preset sem fade; cache por estado e chave visual; CDP/recorte da D1; tempo estimado no diálogo |
| **Desfazer lento e pesado** com milhares de clipes (`_capture` copia tudo) | média | médio | `palavras` só no dinâmico; medir; histórico diferencial é outra frente |
| Mexer em `tituloRender.js` quebra todos os títulos | baixa | alto | Teste de chave idêntica nos 15 presets; canônico; harness B |
| Números da Netflix não conferidos (domínio bloqueado nesta sessão) | média | baixo | Tudo em Configurações; pergunta 11 |
| Regenerar apaga trabalho manual | média | alto | Editadas fixadas por `chave`; confirmação; Ctrl+Z |
| Subclipe: transcrição do arquivo-pai mal resolvida | média | médio | Teste com subclipe real na E1; sem transcrição, aviso por clipe |
| Conflito de merge com D1 (`titulos.py`) e com a outra sessão da interface (`index.html`, `player.js`) | média | médio | E7 só depois da D1 Etapa 3; commit só dos meus trechos |
| Licença | baixa | médio | Cabeçalho Apache-2.0 em `legendaAgrupamento.js` e `alucinacao.py`; sem GSAP; sem `@chenglou/pretext` (licença não verificada) |

## 12. Perguntas para o Fernando

| # | Pergunta | Recomendação |
|---:|---|---|
| 1 | Clássico como padrão do documentário e dinâmico só para cortes de redes? | Sim |
| 2 | Limite de 17 caracteres por segundo (adulto)? | Sim, como aviso, não trava; acima de 20 fica vermelho |
| 3 | Legenda entrar 0,08 s antes da fala e ficar 0,25 s depois? | Sim, com "deslocar todas" no diálogo |
| 4 | Falas sobrepostas: segunda pista "Legendas 2" ou hífen no mesmo bloco? | Segunda pista agora; hífen depois |
| 5 | SRT, VTT e ASS só com as legendas (padrão) ou com todos os textos? | Só legendas quando existirem, com botão para todos |
| 6 | Palavras em silêncio final: remover por padrão (listadas na prévia) ou só marcar? | Remover e listar; reversível |
| 7 | Estilo clássico: branco, contorno e sombra, sem caixa; faixa só se a luminância avisar? | Sim |
| 8 | Inter 600 a 44 px (em 1080p), base a cerca de 8 % da altura? | Sim; ajustar vendo no Program |
| 9 | Gravar `<nome>_legendas.srt` ao lado do OTIO/XML? | Sim (`legendas.srt_ao_lado`) |
| 10 | Camada contínua (E7) e luminância (E8) só se a medição pedir? | Sim |
| 11 | Liberar `backlothelp.netflix.com` na rede da sessão, ou conferir você mesmo no guia PT-BR a duração mínima, o máximo, o intervalo e as 2 linhas? | Conferir antes de fechar a E1 |
| 12 | Posso usar 3 transcrições reais (uma com ruído, uma com silêncio final alucinado) como golden? | Sim, dos gabaritos do chat 06 |

## 13. Prompt para o chat de implementação

Cole o bloco abaixo num chat novo. Ele manda ler este plano (`docs/plano_hyperframes/C_legendas.md`).

~~~~markdown
# Chat 09: legendas a partir da transcrição (frente C)

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> As Etapas 0 a 6 não dependem de outro chat. A Etapa 7 só depois da D1 (Etapa 3, pacote `src/navegador/`); a Etapa 9, só depois da B.

---

Quero gerar as legendas da montagem a partir da transcrição palavra a palavra do CapIAu Talho: clássica para documentário (42 caracteres por linha, 2 linhas, 17 caracteres por segundo) e dinâmica, com destaque da palavra falada, para cortes curtos. Cada legenda vira um clipe de texto comum, com um bloco `legenda`. Leia antes `docs/plano_hyperframes/C_legendas.md` (o plano completo, com pseudocódigo e tabela de casos) e `docs/PESQUISA_HYPERFRAMES.md` §4.2 (a §2.3 do plano corrige essa seção), e confira no código cada afirmação; linhas podem ter andado.

## O que já existe (conferido em 28/10/2026)

- Palavras: tabela `transcript` (`src/db/schema.py:173`), gravada por `save_transcript_words` (`src/db/repositories/narrative.py:7`) a partir de `src/transcription/asr_engine.py:225-240`; rota `GET /api/video/{id}/transcript` (`src/api/routes/narrative.py:48`). `dialogue_utterance` e `dialogue_word` (`schema.py:515`) não são lidas nem escritas por nada em `src/`.
- Mapa fonte para timeline: `src/ui/js/player.js:4016` (`_targetSecondsFor`) e `src/export/video_render/modelo.py:157` (`trecho_fonte`). Só pista de áudio soa (P3); numa pista vence o primeiro clipe da lista (P4).
- Clipes de texto: `timelineState.js:4941` (`addTextClip`); `corteParaSalvar` repassa os campos extras e `save_timeline` grava como veio. Desenho único em `src/ui/js/tituloRender.js` (um `<span>`; `estadoTitulo` é a chave de dedupe). Render em `titulos.py` e `comando.py:638`: uma entrada e dois filtros por clipe.
- Export: SRT e VTT saem de uma cópia JS (`panels.js:2521-2563`); `src/export/subtitles_export.py` não tem chamador; `src/api/routes/narrative.py:530` só aceita otio, xml e edl.
- Desfazer copia todos os clipes (`timelineState.js:8366`).

## O que fazer (um commit por etapa, mensagens `feat(legendas): ...`)

0. **Medir** (`scripts/legendas_medir.py`): ms por foto de título, tamanho do `cmd` com 70 legendas, `_capture` do histórico com 600 e 2 700 clipes. Mostre-me os números antes de seguir.
1. **Módulos puros** em `src/ui/js/` (`legendaProjecao.js`, `legendaAgrupamento.js`, `legendaAvisos.js`) e autotestes Node `tests/autoteste_legenda_*.mjs`: projeção (velocidade, reverso, freeze, J/L-cut, subclipe por `parent_video_id`, P3 e P4, palavra na borda mantida se ≥ 50 % cai dentro), agrupamento clássico e avisos. Pseudocódigo e casos: plano §4.1, §4.2, §9.
2. **Servidor:** `src/transcription/alucinacao.py` e `src/services/legendas_fonte.py` com `POST /api/legendas/fonte`: tokens sem sentido (> 20 %), palavra em silêncio final (`silencedetect` -35 dB, 0,6 s, só nos últimos 60 s) e `repeticao_em_loop`. Lê o que já está gravado; o ASR não muda.
3. **Clipes:** `legendaClipes.js`, `addTextClips` numa transação do histórico, pista "Legendas", preset clássico, âncora de base em `tituloRender.js`, chave visual do cache em `titulos.py`. Cenário canônico antes do commit.
4. **Interface:** diálogo "Gerar legendas", seção na aba Títulos, menu de contexto, selo de aviso, `Alt+Shift+KeyL`, chaves `legendas.*` em Configurações.
5. **Export único em Python:** `subtitles_export.py` reescrito, rota `export/{srt|vtt|ass}`, cópia JS removida, `metadata.capiau.legenda` no OTIO.
6. **Karaokê:** `agruparDinamico`, palavras e `estadoTitulo.palavra` em `tituloRender.js` (título sem `legenda` mantém a chave idêntica), preset dinâmico. Cenário canônico antes do commit.
7. Só se a Etapa 0 pedir: camada contínua (`src/export/video_render/legendas.py`). 8. Aviso de luminância (opcional). 9. Casos `legenda_*` no harness da frente B.

Presets sem fade. Nenhum número fica fixo no código: tudo em `legendas.*`. Os 42 por linha e os 17 cps vêm de busca na web; duração mínima e máxima e intervalo entre legendas ainda não foram conferidos no guia da Netflix.

## Pergunte-me antes de começar

Limite de caracteres por segundo, falas sobrepostas (segunda pista ou hífen), SRT só com legendas ou com todos os textos, remoção automática no silêncio final, fonte e tamanho do preset (Inter 600, 44 px a 1080p) e se tenho transcrições reais para os testes (plano §12).

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev` e `docs/HANDOFF_DESIGN_UI.md`. Interface: 9–12 px, botões 20–28 px, `var(--fs-N)`, `var(--sp-N)`, `--accent`, nada abre sozinho.
- Outra sessão mexe na interface (`index.html`, `main.js`, `workspaceManager.js`, `styles.css`, `library.js`, `welcomeHub.js`, `player.js` às vezes). Commit só dos seus trechos (índice montado a partir do HEAD), direto na main, sem coautoria, sem push.
- Mudança em render ou player passa no cenário canônico multipista em cascata: `node tests/autoteste_composicao_multipista_cascata.mjs` e `pytest tests/test_render_composicao_multipista_cascata.py`.
- Modelos não baixam sozinhos. Scripts de edição em arquivo, com `PYTHONUTF8=1`. Servidor de teste `capiau-server-venv` (8022).
- Português, direto. Verifique antes de afirmar.

## Pronto quando

A sequência com J-cut e clipe a 2x gera legendas dentro de ± 1 quadro da fala; o clássico respeita 42×2, 5/6 a 7 s e 2 quadros ou mostra o aviso; o dinâmico troca a palavra ativa no quadro certo; preview e arquivo batem nas medidas da B; um Ctrl+Z desfaz a geração; SRT, VTT e ASS saem de uma rota só; título sem `legenda` não muda um pixel.
~~~~
