# Plano de Implementação — Triagem da Pesquisa de 19/08/2026

> Análise crítica de [`Pesquisas/Pesquisa-CapIAu-Talho-19082026.md`](Pesquisas/Pesquisa-CapIAu-Talho-19082026.md)
> contra o código real do repositório. Ordenado por custo-benefício, do maior para o menor.
> Data da análise: 19/08/2026.

---

## Resumo: o que a pesquisa acertou e o que ela errou

A pesquisa é boa no diagnóstico de mercado e ruim na priorização de engenharia.
Três correções de fato, verificadas no código:

### ❌ Erro 1 — "Implementar suporte a HTTP Range Requests no FastAPI" (Fase 3)

**Já está pronto.** O projeto roda Starlette 1.6.0, cujo `FileResponse` trata o header
`Range` nativamente (`starlette/responses.py:362`, retorna 206 + `Content-Range`).
Todas as rotas de mídia em [`media.py`](../src/api/routes/media.py) usam `FileResponse`.
Não há nada a fazer. O código de exemplo da pesquisa reimplementaria à mão algo que
o framework já faz melhor.

### ❌ Erro 2 — WebCodecs é apontado como a solução de frame-accuracy

A pesquisa mistura **dois problemas diferentes** e propõe um projeto de 6-8 semanas
para o menos importante:

| Problema | Sintoma real | Culpado real | Custo do conserto |
|---|---|---|---|
| Scrubbing lento na timeline | trava ao arrastar | GOP de 8,3s nos proxies | **1 linha de FFmpeg** |
| Corte sai deslocado no Premiere | retrabalho na edição | truncamento `int()` na exportação OTIO | **3 linhas de Python** |

WebCodecs não conserta nenhum dos dois. Ver Ferramentas 1 e 2 abaixo.

### ❌ Erro 3 — PBCore como schema paralelo com "migração de dados"

A pesquisa propõe criar `pbcore_asset`, `pbcore_instantiation`, `pbcore_essence_track`,
`pbcore_annotations` e *migrar os dados existentes*. Isso duplicaria o schema atual
(19 tabelas já em produção: `video`, `photo`, `transcript`, `face`, `entity`,
`media_segment`…) e criaria dois lugares para a mesma verdade.

PBCore é um **formato de intercâmbio**, não um modelo de armazenamento. A implementação
certa é um mapeador de saída. Custo: dias, não 4-6 semanas. Ver Ferramenta 5.

---

## Tabela de veredito

| # | Ferramenta | Custo | Impacto | Veredito |
|---|---|---|---|---|
| 1 | GOP curto nos proxies (FFmpeg) | horas | alto | ✅ **Fazer agora** |
| 2 | Correção de frame-accuracy no OTIO | horas | alto | ✅ **Fazer agora** |
| 3 | Sprite sheet de thumbnails | 2-3 dias | alto | ✅ Fazer |
| 4 | faster-whisper local (backend plugável) | 1-2 semanas | alto | ✅ Fazer, **com benchmark antes** |
| 5 | PBCore como exportador | 3-5 dias | médio-alto | ✅ Fazer |
| 6 | OCR de cena (OnnxTR) | 1 semana | médio-alto | ✅ Fazer |
| 7 | WebCodecs | 4-6 semanas | baixo *depois* de 1+3 | ⏸️ Adiar |
| 8 | Jina CLIP v2 | 1 semana + reindexação total | baixo | ⏸️ Adiar |
| 9 | Grounding DINO / Florence-2 | alto | baixo nesta máquina | ❌ Descartar |
| 10 | EBUCore | médio | nenhum hoje | ❌ Descartar |

Máquina de referência: **i7-10700 (8C/16T), 32 GB RAM, sem GPU dedicada** (Intel UHD 630).
Isso restringe pesadamente os itens 4, 8 e 9.

---

# Ferramenta 1 — GOP curto nos proxies

**Custo: horas · Impacto: alto · O melhor custo-benefício do documento inteiro.**

## Diagnóstico (medido, não suposto)

```bash
ffprobe -select_streams v:0 -show_entries frame=key_frame,pts_time \
  -read_intervals "%+20" data/proxies/proxy_vid_100.mp4
```

```
KEYFRAME @ 0.000000
KEYFRAME @ 8.341667
KEYFRAME @ 16.683333
```

**Um keyframe a cada 8,34 segundos** — 250 frames a 29,97fps, que é o `keyint` default
do x264. [`generate_video_proxy()`](../src/media/ffmpeg.py:195) nunca passa `-g`.

Consequência: cada scrub na timeline força o browser a decodificar até 250 frames a
partir do keyframe anterior. É essa a origem do "laggy" que a pesquisa atribui ao
`<video>` e usa para justificar WebCodecs.

> **Nota de precisão:** browsers modernos *fazem* seek exato com `currentTime` (decodificam
> do keyframe até o frame alvo). A tabela "±1 segundo de frame accuracy" da pesquisa está
> errada para `currentTime`; vale para `fastSeek()`. O problema real é **latência**, não
> imprecisão — e latência é exatamente o que GOP curto resolve.

## Implementação

Em [`src/media/ffmpeg.py`](../src/media/ffmpeg.py:208), no `cmd` de `generate_video_proxy`:

```python
    # GOP de ~1s: keyframe a cada N frames, sem keyframes extras por corte de cena.
    # Proxies existem para scrubbing, nao para streaming — GOP curto troca ~15-25% de
    # tamanho de arquivo por seek quase instantaneo na timeline.
    gop = max(1, int(round(source_fps)))

    cmd = [
        'ffmpeg', '-y', '-i', str(original_path),
        '-progress', 'pipe:1',
        '-vf', f'scale=...',
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', str(crf),
        '-g', str(gop),
        '-keyint_min', str(gop),
        '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        str(proxy_path)
    ]
```

`generate_video_proxy` ainda não recebe o fps da fonte. Duas opções:

- adicionar parâmetro `source_fps: float` e passar de [`ingest.py`](../src/services/ingest.py)
  (o fps já está no banco, coluna `video.fps`);
- ou fixar `-g 30` para todo mundo — mais simples, aceitável, GOP entre 0,5s (59,94fps) e 1,25s (24fps).

Recomendo a primeira: o acervo atual tem 29,97 **e** 59,94 misturados.

## Passos

1. Adicionar `source_fps` a `generate_video_proxy` e propagar de `ingest.py`.
2. Adicionar as três flags ao comando.
3. Gerar um proxy de teste e confirmar o intervalo com o `ffprobe` acima (deve dar ~1s).
4. Medir o crescimento do arquivo em 3 clipes representativos (esperado: +15-25%).
5. Escrever `scripts/regenerate_proxies.py` para regerar o acervo já ingerido.

## Ponto de atenção

Os proxies existentes **não** se beneficiam sem regeração. Com o acervo atual isso é
tempo de CPU significativo — rodar de madrugada, em lote, com retomada. Não apagar o
proxy antigo antes de o novo terminar e ser validado.

---

# Ferramenta 2 — Frame-accuracy real na exportação OTIO

**Custo: horas · Impacto: alto · É *aqui* que o retrabalho no Premiere nasce.**

## Diagnóstico (bug confirmado no banco de produção)

A timeline no frontend é frame-based, mas o `sequence_json` grava em **segundos float**:

```
timeline id 4: {'video_id': 89, 'in': 3.72589, 'out': 15.126423, 'timeline_start': 0.0}
timeline id 2: {'video_id': 54, 'in': 1.425321, 'out': 6.764048}
```

E [`otio_export.py:175`](../src/export/otio_export.py:175) converte de volta com **truncamento**:

```python
start_time=otio.opentime.RationalTime(int(in_s * fps), fps),
duration=otio.opentime.RationalTime(int((out_s - in_s) * fps), fps)
```

Fazendo a conta com dados reais, a 29,97fps:

| clipe | `in` (s) | × fps | frame correto | frame exportado | erro |
|---|---|---|---|---|---|
| vídeo 89 | 3.72589 | 111.674 | **112** | 111 | −1 frame |
| vídeo 54 | 1.425321 | 42.727 | **43** | 42 | −1 frame |
| vídeo 105 | 4.672259 | 140.028 | 140 | 140 | ok |

**O corte entra 1 frame antes do que o editor viu, na maioria dos clipes.** O mesmo
truncamento está nos gaps (`int(gap_dur * timeline_fps)`, linha 136) e nas durações —
e no gap o erro **acumula ao longo da track**, deslocando progressivamente todo clipe
seguinte.

Nenhuma quantidade de WebCodecs conserta isso: o erro acontece do lado Python,
depois de o editor já ter visto o frame certo.

## Implementação

**Correção mínima (30 min):** trocar `int()` por `round()` nas ocorrências de
`otio_export.py` (linhas 136, 143, 148, 153, 170, 175, 176). Elimina o erro de −1 frame.

**Correção correta (1 dia):** parar de fazer o round-trip frames → segundos → frames.

1. Passar a gravar frames inteiros no `sequence_json` (`in_frames`, `out_frames`,
   `timeline_start_frames`), mantendo os campos em segundos por compatibilidade de leitura.
2. `ProjectRepository.parse_sequence` migra registros antigos na leitura:
   `in_frames = round(in_s * fps)` — uma única conversão, no ponto de entrada.
3. `otio_export` consome frames direto, sem multiplicação.

**Bônus, mesma sessão — fps racional:**

`RationalTime(n, 29.97)` deveria ser `RationalTime(n, 30000/1001)`. O drift numérico é
desprezível, mas alguns adaptadores (FCPXML, CMX3600) escrevem o timebase do arquivo
a partir dessa taxa, e **29.97 float pode virar timebase 29 ou 30 não-drop** no Premiere.
Normalizar as taxas NTSC:

```python
NTSC = {24: 24000/1001, 30: 30000/1001, 60: 60000/1001}

def rational_fps(fps: float) -> float:
    """Normaliza taxas NTSC para a fracao exata; adaptadores FCPXML/EDL dependem disso."""
    for base, exact in NTSC.items():
        if abs(fps - base * 1000 / 1001) < 0.01:
            return exact
    return fps
```

**Terceiro: matar o fallback `24.0`.** Ele aparece em `otio_export.py:73` e espalhado
por `timelineState.js` (`fps = 24` em 6 assinaturas de função). O acervo é 29,97/59,94 —
um fallback de 24 é garantia de timeline errada quando o valor não chega. Preferir
falhar explícito a assumir 24.

## Passos

1. `round()` no lugar de `int()` — commit isolado, é a correção de maior valor por linha.
2. Teste de regressão: exportar timeline 4, abrir o `.otio`, conferir `start_time` = 112.
3. Normalizar fps NTSC.
4. Migrar `sequence_json` para frames.
5. Remover fallbacks `24`.
6. Validar de verdade: exportar → importar no Kdenlive e no Resolve → conferir o timecode
   do primeiro corte contra o que o Talho mostra.

---

# Ferramenta 3 — Sprite sheet de thumbnails na timeline

**Custo: 2-3 dias · Impacto: alto · Substitui a metade útil do WebCodecs.**

## Diagnóstico

[`timelineRenderer.js:714`](../src/ui/js/timelineRenderer.js:714) pede cada miniatura
individualmente:

```javascript
img.src = `/api/video/${videoId}/thumbnail-at?time=${timestamp.toFixed(1)}&tentativa=...`;
```

Uma track de 10 minutos com miniatura a cada 80px em zoom médio = **dezenas de requests
HTTP simultâneos**, cada um disparando um seek + decode de FFmpeg no backend. É a
operação mais cara da interface hoje.

## Implementação

Gerar na ingestão, junto com o proxy, uma folha de sprites por vídeo:

```python
def generate_filmstrip(proxy_path: Path, out_path: Path, duration: float,
                       interval: float = 2.0, thumb_w: int = 160) -> dict:
    """Gera uma folha de sprites (grade JPEG) com um frame a cada `interval` segundos.

    Um unico request substitui N requests de /thumbnail-at. Retorna o manifesto
    (cols, rows, interval, thumb_w, thumb_h) que o frontend usa para recortar via
    drawImage(sx, sy, ...) direto no canvas.
    """
    cols = 10
    n = max(1, int(duration / interval))
    rows = (n + cols - 1) // cols
    cmd = [
        'ffmpeg', '-y', '-i', str(proxy_path),
        '-vf', f'fps=1/{interval},scale={thumb_w}:-1,tile={cols}x{rows}',
        '-frames:v', '1', '-q:v', '5',
        str(out_path)
    ]
    ...
```

No frontend, `drawImageCover` passa a recortar da folha já carregada em vez de baixar
um `<img>` por miniatura. Zero request por scrub, zero FFmpeg em runtime.

## Passos

1. `generate_filmstrip()` em `ffmpeg.py`; chamar no pipeline de ingestão após o proxy.
2. Guardar o manifesto (`filmstrip_path`, `interval`, `cols`, `thumb_w`, `thumb_h`) —
   coluna JSON nova em `video`, ou arquivo `.json` ao lado da folha.
3. Rota `GET /api/video/{id}/filmstrip` (`FileResponse` + cache headers longos).
4. `timelineRenderer` carrega a folha uma vez por vídeo e recorta por offset.
5. Manter `/thumbnail-at` como fallback para vídeos ainda sem folha.
6. Script de backfill para o acervo existente.

## Ponto de atenção

Em zoom máximo, o intervalo de 2s fica visivelmente grosseiro. Solução: duas folhas
(2s para visão geral, 0,5s sob demanda) ou aceitar a granularidade — o proxy com GOP
curto (Ferramenta 1) já torna o `/thumbnail-at` sob demanda rápido o suficiente para o
zoom fechado.

---

# Ferramenta 4 — faster-whisper local (backend plugável)

**Custo: 1-2 semanas · Impacto: alto (custo + privacidade) · Mas a pesquisa erra sobre a performance.**

## Correção da pesquisa

> "Roda 70x tempo real na CPU"

**Falso.** O número de 70x do README do WhisperX é com **GPU e batching**. Esta máquina
não tem GPU dedicada — só Intel UHD 630, que não serve para inferência de Whisper.

Além disso, a diarização do WhisperX não é "nativa": ela chama **pyannote.audio**, que
exige token do HuggingFace, aceite de licença e é pesada em CPU. Hoje o
[`asr_engine.py:174`](../src/transcription/asr_engine.py:174) obtém diarização de graça
com `speaker_labels=True` na AssemblyAI. Trocar por local **piora** esse aspecto até
prova em contrário.

## Portanto: benchmark antes de commit

**Passo 0, meio dia, antes de escrever qualquer integração.** Pegar um vídeo real
(o vídeo 8 tem 1905s ≈ 32 min), extrair o MP3 16k mono que o pipeline já gera, e medir:

| Config | Métrica | Critério de aceite |
|---|---|---|
| `large-v3`, int8, 8 threads | tempo total ÷ duração do áudio | < 1,0× |
| `medium`, int8, 8 threads | idem | < 0,5× |
| `small`, int8, 8 threads | idem | < 0,25× |
| + pyannote (diarização) | tempo adicional | — |

E medir **qualidade**, não só velocidade: rodar o mesmo áudio pela AssemblyAI, alinhar
as duas transcrições e contar WER em português com sotaque goiano. Se o `medium` local
custar 3× mais tempo de máquina e entregar transcrição pior, a economia não compensa
para o fluxo de trabalho de documentário.

## Implementação (se o benchmark aprovar)

Não substituir — **tornar plugável**. Espelhar o padrão que o projeto já usa em
[`src/vision/backends/`](../src/vision/backends/) (`base.py`, `local_backend.py`,
`aws_backend.py`, `azure_backend.py`):

```
src/transcription/
├── asr_engine.py               # orquestra, escolhe backend por CONFIG/settings
└── backends/
    ├── base.py                 # ASRBackend: transcribe(audio, lang) -> list[Word]
    ├── assemblyai_backend.py   # extrai o codigo atual, sem mudar comportamento
    └── faster_whisper_backend.py
```

Chave nova em `.env.example` e no `settings_registry`: `ASR_BACKEND=assemblyai|faster_whisper`,
padrão `assemblyai`. Assim nada quebra e dá para comparar lado a lado no acervo real.

## Passos

1. Benchmark (passo 0 acima) — **decide se o resto acontece**.
2. Extrair `assemblyai_backend.py` do `asr_engine.py` atual, sem mudança funcional. Testar.
3. Implementar `faster_whisper_backend.py` (`faster-whisper` puro, sem WhisperX no começo —
   o Whisper já devolve timestamps por palavra com `word_timestamps=True`).
4. Expor o seletor nas configurações do projeto.
5. Diarização local: **fase separada**, só se o passo 1 mostrar folga de CPU.
6. Documentar o custo real medido em [`costs_and_security.md`](costs_and_security.md).

## Ponto de atenção

`requirements.txt` ganharia `faster-whisper` + `ctranslate2`. O `torch>=2.2.0` já está lá.
Modelos `large-v3` int8 ocupam ~1,5 GB em disco — cabem em `data/models/`, que já existe.

---

# Ferramenta 5 — PBCore como exportador (não como schema)

**Custo: 3-5 dias · Impacto: médio-alto · A pesquisa pediu 4-6 semanas por um erro de arquitetura.**

## Correção da pesquisa

A pesquisa propõe tabelas paralelas + migração. Isso é errado por três razões:

1. O schema atual já tem os dados. `video` tem `duration`, `fps`, `resolution`, `codec`,
   `bitrate`, `title`, `description`, `tags`, `hash` — isso *é* uma Instantiation PBCore.
2. Duplicar cria duas verdades. Qual vence quando divergem?
3. PBCore é padrão de **intercâmbio**. Ninguém armazena em PBCore; exporta-se para PBCore.

## Implementação certa: um mapeador

`src/export/pbcore_export.py`, espelhando o que `otio_export.py` já faz para timelines:

| PBCore | Origem no schema atual |
|---|---|
| `pbcoreIdentifier` | `video.hash` (SHA-256, já é único e estável) |
| `pbcoreTitle` | `video.title` |
| `pbcoreDescription` | `video.description` / `video.summary` |
| `pbcoreSubject` | `video.tags` + `entity` via `entity_mention` |
| `pbcoreGenre` | `video.category` |
| `instantiationDigital` | mime derivado de `video.codec` |
| `instantiationDuration` | `video.duration` |
| `instantiationLocation` | `video.filepath` |
| `essenceTrackFrameRate` | `video.fps` |
| `essenceTrackFrameSize` | `video.resolution` |
| `pbcoreAnnotation` (timed) | `transcript` (start/end/speaker/text) |
| `pbcoreAnnotation` (timed) | `face` + `person` via `face_recognition` |
| `pbcoreAnnotation` (timed) | `media_segment`, `theme_segment` |
| `pbcoreRelation` | tabela `relation` (já existe) |
| `pbcoreCollection` | `project` |

Nenhuma tabela nova. Nenhuma migração. Nenhum risco para dados existentes.

A "killer feature" que a pesquisa descreve — *catálogo PBCore completo gerado
automaticamente pelas IAs locais* — sai de graça, porque as anotações já estão no banco.

## Passos

1. `pbcore_export.py` com `export_project_pbcore(project_id) -> str` (XML).
2. Validar contra o XSD oficial (`pbcore.org/xsd`) — baixar o `.xsd`, validar com `lxml`.
   Sem validação contra o schema, "exportar PBCore" é só XML com nomes bonitos.
3. Rota `GET /api/project/{id}/export/pbcore` → `Response(media_type="application/xml")`.
4. Botão de exportação na UI, ao lado da exportação OTIO existente.
5. Ficha de metadados editável na biblioteca para os campos que a IA não preenche
   (`creator`, `publisher`, `rightsSummary`, `dateCreated`) — **esses sim** justificam
   colunas novas em `video`/`project`.

## Ponto de atenção

O passo 5 é o único que toca o schema, e é aditivo (4 colunas). `rightsSummary` importa
de verdade para documentário — é o campo que diz se um take pode ir ao ar.

---

# Ferramenta 6 — OCR de cena (OnnxTR)

**Custo: ~1 semana · Impacto: médio-alto · Independente de tudo acima.**

## Por que vale

Documentário vive de B-roll com texto: placa, manchete de jornal, documento, letreiro,
crédito. Hoje esse conteúdo é **invisível** para a busca do Talho. É a única funcionalidade
nova da pesquisa que abre uma categoria de busca que não existe.

## Implementação

O gancho já existe: [`vision_batch.py`](../src/services/vision_batch.py) e
[`media_segment`](../src/db/schema.py:224) já processam frames-chave por segmento.
O OCR entra no mesmo laço, sobre frames que já são extraídos — custo marginal de I/O zero.

1. Tabela `ocr_text` (`video_id`, `photo_id`, `timestamp`, `text`, `confidence`, `bbox`)
   — ou reaproveitar `entity_mention` com um `source` novo. Prefiro tabela própria:
   OCR tem ruído e convém poder limpar sem tocar em entidades curadas.
2. Filtro de confiança agressivo (`> 0.7`) e descarte de strings com menos de 3 caracteres —
   OCR em vídeo comprimido gera muito lixo.
3. Indexar o texto no Qdrant, na coleção de texto existente, com payload marcando
   `source: "ocr"` — assim a busca semântica atual passa a alcançar B-roll sem mudança na UI.
4. Filtro `ocr:` no [`searchParser.js`](../src/ui/js/searchParser.js), que já tem
   gramática de filtros.

## Ponto de atenção

Escolher **OnnxTR** e não PaddleOCR: o projeto já roda ONNX Runtime para YuNet/SFace,
e o PaddleOCR arrasta o PaddlePaddle inteiro como dependência. Menos uma stack.

---

# ⏸️ Ferramenta 7 — WebCodecs: adiar

**Não porque seja ruim — porque as Ferramentas 1 e 3 entregam a maior parte do benefício
por uma fração do custo.**

Depois de GOP curto + sprite sheet, reavaliar com uma pergunta honesta: *o scrubbing
ainda incomoda?* Se sim, WebCodecs tem lugar. Se não, são 6 semanas para reescrever um
player que funciona.

O que **sobraria** para o WebCodecs resolver de fato:

- render de preview de export no browser (`VideoEncoder`) — hoje inexistente;
- acesso a `VideoFrame` para análise de IA no cliente — não é o modelo do Talho (a IA roda no backend).

Nenhum dos dois é dor atual. E o `player.js` (1923 linhas) tem lógica não trivial de
anti-drift em playback multi-clipe ([linhas 1076-1101](../src/ui/js/player.js:1076)) que
precisaria ser reescrita do zero — risco alto de regressão em algo que já funciona.

Se um dia for feito, o pré-requisito é o índice de keyframes por proxy — que a Ferramenta 1
torna trivial (keyframes previsíveis a cada N frames, sem precisar de índice).

---

# ⏸️ Ferramenta 8 — Jina CLIP v2: adiar

**O custo escondido é a reindexação.**

O projeto usa `clip-ViT-B-32` (512d) + `clip-ViT-B-32-multilingual-v1` no mesmo espaço
vetorial ([`image_semantic.py:21`](../src/search/image_semantic.py:21)). Jina CLIP v2 tem
1024 dimensões — **muda o `VectorParams(size=)` da coleção**, obrigando a recriar e
reprocessar todas as imagens e frames do acervo.

Existe `reindex_all()` em [`semantic.py:556`](../src/search/semantic.py:556) para a coleção
de texto, mas o caminho de imagem precisaria do equivalente. O ganho — "melhor em conceitos
abstratos" — é real, porém difuso e difícil de medir.

**Condição para reconsiderar:** ter um conjunto de avaliação. 30 buscas reais de B-roll com
o resultado esperado anotado à mão. Sem isso, a troca é fé, não engenharia. Vale mais
investir esse tempo na Ferramenta 6 (OCR), que adiciona informação nova em vez de
reordenar a existente.

---

# ❌ Ferramenta 9 — Grounding DINO / Florence-2: descartar

Florence-2-base tem ~230M de parâmetros; Grounding DINO, ~172M. Rodar por frame-chave em
um acervo de centenas de horas, numa CPU sem GPU, é ordens de magnitude mais lento que o
CLIP atual. O `vision_batch` já delega a descrição semântica pesada ao Gemini via
OpenRouter, com controle de custo por segmento — que é a decisão certa para esta máquina.

Reconsiderar apenas se houver GPU no futuro.

---

# ❌ Ferramenta 10 — EBUCore: descartar

Trabalho especulativo. O próprio documento classifica como prioridade baixa e justifica
por "coproduções europeias" — que não existem hoje na Vozes do Asfalto. O mapeador
PBCore→EBUCore da pesquisa tem ~40 linhas; se um cliente europeu aparecer, escreve-se na
hora, em cima do exportador da Ferramenta 5.

---

# Ordem de execução sugerida

**Semana 1 — as correções baratas (maior retorno do plano inteiro)**

- Ferramenta 2: `round()` no OTIO. Commit isolado, meio dia, corrige −1 frame por clipe.
- Ferramenta 1: GOP curto + script de regeração de proxies.
- Ferramenta 2 (resto): fps racional NTSC, matar fallbacks de 24.
- Validar de ponta a ponta: exportar → Kdenlive/Resolve → conferir timecode do corte.

**Semanas 2-3 — performance da interface**

- Ferramenta 3: sprite sheet, rota, renderer, backfill.

**Semana 4 — decisão sobre transcrição**

- Ferramenta 4, passo 0: benchmark de faster-whisper com áudio real. **Só então** decidir.

**Semanas 5-6 — profissionalização do catálogo**

- Ferramenta 5: exportador PBCore + validação XSD + ficha de metadados.

**Semanas 7-8 — busca em B-roll**

- Ferramenta 6: OCR de cena.

**Depois** — reavaliar WebCodecs e Jina CLIP v2 com dados de uso real, não com base neste documento.

---

## Uma nota sobre o documento de pesquisa

O valor dele está no benchmark de mercado (CatDV, Axle.ai, Forscene) e no argumento de
posicionamento — *MAM inteligente local-first para documentário* — que está correto e é
defensável comercialmente.

A parte de engenharia foi escrita sem ler o código: propõe implementar o que já existe
(Range requests), aponta o culpado errado para o problema certo (WebCodecs em vez de GOP e
truncamento) e sugere duplicar um schema em produção. Vale guardar como pesquisa de
mercado; não vale seguir como roadmap.
