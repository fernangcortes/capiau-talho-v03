# 🔌 Detalhamento das APIs de Visão, Faces e Áudio

Abaixo estão listadas as rotas do backend FastAPI que gerenciam o fluxo
de detecções, desambiguação, anotações e tratamento de áudio do
CapIAu-Talho:

## 1. Rotulação e Resolução de Conflitos

### POST /api/faces/face/{face_id}/label

- **Descrição:** Atribui um nome à detecção facial. Se a detecção
  pertencer a um cluster/grupo, aplica o nome a todas as faces do mesmo
  grupo.

- **Payload:**

> {
>
> \"name\": \"Nome da Pessoa/Objeto\"
>
> }

- **Resolução de Conflitos:** Se o nome fornecido já estiver associado a
  outro cluster, a API retorna um status conflict com os IDs dos
  clusters conflitantes, permitindo que o frontend inicie uma modal de
  desambiguação para fusão manual (merge) ou reatribuição (reassign).

## 2. Fusão de Grupos e Reatribuição de Rostos

### POST /api/faces/project/{project_id}/faces/merge

- **Descrição:** Une por completo o cluster de origem ao de destino.

- **Payload:**

> {
>
> \"src_cluster_id\": int,
>
> \"dest_cluster_id\": int,
>
> \"name\": \"Nome Confirmado\"
>
> }

### POST /api/faces/project/{project_id}/faces/reassign

- **Descrição:** Transfere individualmente apenas as detecções
  selecionadas de um grupo para o grupo correto.

- **Payload:**

> {
>
> \"face_ids\": \[12, 15, 23\],
>
> \"target_cluster_id\": int,
>
> \"target_name\": \"Nome\"
>
> }

## 3. Rejeição e Catalogação de Objetos

### POST /api/faces/face/{face_id}/reject

- **Descrição:** Descarta uma detecção de rosto errônea.

  - Se nenhum nome for fornecido (ou deixado em branco), a detecção é
    rotulada como \"Não Relevante\" e seu status é atualizado para
    rejected, sendo totalmente ignorada nos algoritmos de clustering e
    de enriquecimento RAG.

  - Se um nome de objeto for fornecido (ex: Abajur), a detecção é
    arquivada como rejected (para não poluir o clustering de pessoas),
    mas o nome do objeto é persistido no banco de dados para indexação
    na busca semântica e enriquecimento textual de B-rolls.

- **Payload (Opcional):**

> {
>
> \"name\": \"Nome do Objeto\"
>
> }

## 4. Desenho de Caixas Manuais (Drag-and-Draw)

### POST /api/faces/face

- **Descrição:** Permite criar uma nova marcação retangular nas
  coordenadas normalizadas do vídeo ou da foto, permitindo indexar
  elementos e objetos personalizados do set.

- **Payload:**

> {
>
> \"project_id\": 1,
>
> \"video_id\": 2, // Opcional
>
> \"photo_id\": null, // Opcional
>
> \"timestamp\": 12.5, // Opcional
>
> \"bounding_box\": \[0.12, 0.34, 0.25, 0.45\], // \[x, y, w, h\]
> normalizados de 0.0 a 1.0
>
> \"name\": \"Nome do Objeto/Pessoa\"
>
> }

## 5. Busca Visual e "Encontrar Similares" (CLIP Local)

Rotas da reforma de pipeline da Etapa 2 (ver `docs/PLANO_IMPLEMENTACAO.md`)
que rodam 100% localmente via embeddings CLIP, sem custo de API.

### GET /api/search/visual

- **Descrição:** Busca por conceito visual em linguagem natural (português),
  mesmo sem palavra correspondente na descrição textual gerada por IA.

- **Query params:** `q` (texto da busca), `project_id`.

- **Uso interno:** também é consultado pela busca híbrida
  (`search_hybrid`), entrando na fusão de resultados com peso
  configurável `search.image_weight` antes do MMR.

### GET /api/media/photo/{photo_id}/similar

- **Descrição:** Retorna as fotos/vídeos visualmente mais próximos de uma
  foto já indexada.

- **Query params:** `project_id` (default 1), `limit` (default 12).

- **Resposta:** `{ photo_id, results: [{ id, score, payload }] }` — o
  `payload` de resultados-foto já vem enriquecido com `filename`,
  `filepath`, `title`, `description` e `proxy_path` do banco.

### GET /api/media/video/{video_id}/similar

- **Descrição:** Retorna as mídias visualmente mais próximas do keyframe
  indexado mais perto de um timestamp do vídeo.

- **Query params:** `project_id` (default 1), `timestamp` (segundos,
  default 0.0), `limit` (default 12).

- **Resposta:** mesmo formato do endpoint de foto.

### POST /api/media/batch-similar

- **Descrição:** Executa a busca por similaridade visual em lote a partir de uma lista de IDs de fotos ou vídeos.

- **Payload:** `{ "photo_ids": [1, 2], "video_ids": [5], "project_id": 1, "limit": 12 }`

## 6. Tarefas de Miniaturas & Configurações de IA

### POST /api/media/thumbnails/sync
- **Descrição:** Sincroniza e força o re-processamento ou verificação da fila de miniaturas em background.

### POST /api/media/thumbnails/task/{task_id}/cancel
- **Descrição:** Cancela ou pausa a execução de uma tarefa individual de geração de miniatura.

### GET /api/settings/vision-model
- **Descrição:** Retorna o modelo de visão atualmente selecionado e a lista de provedores/modelos disponíveis (Nemotron 70B, Gemini 2.5 Flash, Gemini 3.1 Flash Lite).

### POST /api/settings/vision-model
- **Descrição:** Atualiza dinamicamente o modelo de visão ativo para triagem e descrição de keyframes.
- **Payload:** `{ "model": "nvidia/nemotron-4-70b-vision" }`

## 8. Diagnóstico e Tratamento de Áudio

Sete rotas que sustentam o painel de Ajustes de áudio. O princípio que as
organiza: **o arquivo original nunca é tocado**. Todo tratamento gera um WAV
derivado em `data/audio_tratado/{video_id}/{chain_hash}.wav` e o clipe guarda
apenas um ponteiro.

### GET /api/video/{video_id}/audio/analysis

- **Descrição:** Mede o áudio do intervalo com um passe de ffmpeg
  (`ebur128` + `astats`) e devolve loudness (LUFS), pico real (dBTP),
  clipping, piso de ruído, faixa de loudness (LRA) e correlação entre os
  canais, mais os selos de severidade e o preset sugerido. Devolve também o
  envelope e a lista de momentos de estouro, com tempo absoluto na fonte.

- **Query:** `in`, `out` (segundos), `refresh` (ignora o cache).

- **Cache:** o resultado é gravado na tabela `audio_render`; a segunda
  chamada do mesmo intervalo responde em milissegundos.

- **Guarda:** intervalo acima de `audio.analise.teto_intervalo_s`
  (padrão 2400 s) devolve **400** — a análise é síncrona e um pedido longo
  demais prenderia o servidor.

- **Origem:** prefere o arquivo original; se o acervo bruto estiver
  inacessível cai para o proxy local e declara isso no campo `fonte`, porque
  os números medidos no proxy podem diferir do bruto.

### POST /api/video/{video_id}/audio/render

- **Descrição:** Monta a cadeia de tratamento e produz o WAV derivado.

- **Payload:**

> {
>
> \"in\": float, \"out\": float,
>
> \"preset\": \"resgate_estourado\" \| \"cadeia\": \[\"adeclip\", \"loudnorm:-16:-1.5\"\],
>
> \"engine\": \"local\" \| \"auphonic\",
>
> \"previa\": bool,
>
> \"algorithms_override\": { campo: valor }
>
> }

- **Prévia:** `previa: true` trata apenas 15 s a partir de `in`. É o caminho
  recomendado antes de comprometer um clipe inteiro.

- **Guardas:** `engine: auphonic` sem chave configurada ou sem cota devolve
  **400 antes de qualquer requisição de rede** — produção recusada gastaria o
  envio do mesmo jeito. Prévia na nuvem também é recusada: gastaria cota para
  responder o que o motor local responde de graça. `algorithms_override` só
  vale com o motor de nuvem e é validado contra a grade de valores aceitos.

- **Fila:** cadeia que inclui o passo de denoise por IA não renderiza em
  linha — vai para o worker (`fila: "worker_audio"`), que sabe parti-la. O
  mesmo vale para a prévia com IA. Motor de IA não instalado devolve **400**
  antes de enfileirar um trabalho que falharia minutos depois.

### GET /api/video/{video_id}/audio/render/{chain_hash}

- **Descrição:** Estado do tratamento: `pending`, `running`, `ready` ou
  `failed`, com o caminho do arquivo, o progresso e as análises de antes e
  depois.

- **Correção de estado:** linha marcada `ready` cujo WAV sumiu do disco é
  corrigida para `failed` em vez de mentir sobre o resultado.

### GET /api/audio/tratado/{video_id}/{chain_hash}.wav

- **Descrição:** Serve o WAV tratado para o A/B do player.

- **Guarda:** o `chain_hash` precisa casar com `[0-9a-f]{64}` e o caminho
  resolvido precisa cair dentro de `data/audio_tratado` — qualquer tentativa
  de travessia devolve **400**, e hash válido sem linha correspondente
  devolve **404**.

### GET /api/audio/nuvem/cota

- **Descrição:** Retrato da cota gratuita do Auphonic (2 h por mês,
  recorrentes): `usados_min`, `total_min`, `restante_min`, `avisar` e `mes`.
  É leitura local, sem tocar na rede.

- **Sem chave:** devolve `ok: false` com o motivo legível, nunca **500** — a
  interface usa esta rota para decidir se habilita o motor de nuvem.

### GET /api/audio/nuvem/campos

- **Descrição:** Grade viva dos 17 parâmetros do Auphonic que podem ser
  sobrescritos à mão, com rótulo, ajuda e os valores aceitos. A interface
  monta os controles a partir daqui e **nunca** com a grade escrita no
  JavaScript — ela é do Auphonic e pode mudar.

- **Query:** `video_id`, `in`, `out`. Com o clipe identificado, devolve
  também `automatico`: o que a medição decidiu para aquele trecho, campo a
  campo, para o usuário ver de onde discorda.

- **Nunca ajustáveis:** o corte automático de silêncio e de hesitação não
  aparece nesta lista. Documentário não corta sozinho, nem por sobrescrita.

### GET /api/audio/glossario

- **Descrição:** Os 39 verbetes que explicam áudio para quem monta vídeo,
  cada um com resumo, explicação detalhada e um bloco "na prática". Alimenta
  os ícones de explicação do painel e, pela mesma fonte, o prompt do chat.

- **Query:** `secao` filtra por `diagnostico`, `aovivo`, `tratamento` ou
  `nuvem`. Seção inválida devolve **400** listando as válidas.

## 9. Formas de Onda de Áudio (Waveforms)

### GET /api/videos/{video_id}/waveform
Picos Min/Max reais extraídos do stream PCM. Gera na primeira chamada e serve do cache depois.

**Query:** `sample_rate` (padrão 100 = um par de picos a cada 10 ms) · `force=true` regenera.

```jsonc
{
  "video_id": 247,
  "sample_rate": 100,
  "duration": 451.2,
  "peaks": [-0.12, 0.14, -0.31, 0.29, ...]   // plano: [min0, max0, min1, max1, ...]
}
```

Vídeo sem trilha de áudio devolve `peaks: []` e o motivo em `error` — não é erro HTTP: a ausência de
áudio é um fato sobre a mídia, não uma falha do pedido.

### POST /api/projects/{project_id}/generate-waveforms
Gera as formas de onda de todo o projeto (botão **Ondas** da Biblioteca). Roda em segundo plano e
publica progresso no TASK_MANAGER.

---

## 10. Render de Vídeo da Timeline

### POST /api/timeline/{timeline_id}/render/preflight
**Não renderiza nada.** É o que o painel chama ao abrir. Barato de propósito: só banco e metadado,
nenhum ffprobe, nenhum decode.

**Corpo:** o mesmo do render (o resultado depende do escopo e do tipo).

```jsonc
{
  "ok": true, "nome": "7v3", "duracao_s": 47.85, "fps": 59.94,
  "resolucao": { "largura": 1920, "altura": 1080 },
  "clipes_total": 6, "clipes_no_render": 6,
  "pistas": [ { "id": "V2", "kind": "video", "clipes": 3, "muted": false, "hidden": false } ],
  "midia": { "ausentes": [], "originais_indisponiveis": [], "usa_proxy_fallback": false },
  "fidelidade": { "pode_renderizar": true, "avisos": [
      { "nivel": "warn", "codigo": "JOELHO_COMPRESSOR", "titulo": "...", "clipes": ["cut_1"] } ] },
  "bloqueios": [],
  "assinatura": { "clipes": 6, "efeitos": 0, "duracao_total_s": 47.85 },
  "saida": { "diretorio": "...", "nome_arquivo_sugerido": "7v3_2026-08-24_1112.mp4" }
}
```

`assinatura` existe para o painel comparar a versão salva com a que está na tela: o auto-salvamento
grava em `localStorage`, então exportar sem salvar renderizaria a montagem anterior.

Avisos de nível `block` (mídia ausente, master sem original) **impedem** o render; `warn` só avisa.

### POST /api/timeline/{timeline_id}/render
Valida, recusa em bloqueio e **enfileira** — nunca segura o request.

```jsonc
{ "kind": "draft",                       // draft | master
  "range": { "mode": "full" },           // ou { "mode":"in_out", "start_s":12.4, "end_s":95.0 }
  "preset": "master_1080",
  "overrides": { "resolution": null, "fps": null, "container": "mp4", "codec": "h264",
                 "crf": null, "audio_bitrate": null, "mute_audio": false },
  "scope": { "categories": { "color": true }, "tracks": { "V1": true } },
  "output": { "dir": null, "filename": null },
  "post": { "open_folder": true, "copy_path": false, "save_as": false, "ingest": false },
  "allow_proxy_fallback": false }
```

> Chave **ausente** em `categories`/`tracks` significa **ligado**. Campo `null` em `overrides`
> significa "usa o do preset" — não é erro.

**Resposta:** `{ "task_key": "render_timeline_9", "saida_prevista": "..." }`.
**409** quando já há render daquela timeline na fila (a fila é sequencial, uma por timeline).

### GET /api/timeline/{timeline_id}/render/ultimo
Último render daquela timeline: caminho, tamanho, parâmetros e se o arquivo ainda está no disco.

### POST /api/render/revelar
Abre o explorador de arquivos com o arquivo **selecionado**. Corpo: `{ "caminho": "..." }`.

Guarda de caminho: só revela arquivos dentro das pastas de exportação. Fora delas responde **403** —
sem isso a rota seria um "abra qualquer caminho desta máquina" exposto por HTTP.

### Progresso e cancelamento
Não há rota própria: o render usa as genéricas da casa.
`GET /api/conversions` traz o progresso (procure a chave `render_timeline_<id>`) e
`POST /api/task/{task_key}/cancel` cancela.

---

## 7. Ingestão Direta, Análise Individual e Integração com Sistema

### POST /api/project/{project_id}/upload-direct
- **Descrição:** Ingestão multipart/form-data direta de múltiplos arquivos para a pasta `watch/` com disparo automático de ingestão em segundo plano.
- **Payload:** `files: List[UploadFile]`

### POST /api/video/{video_id}/analyze-all
- **Descrição:** Dispara a análise completa de IA (ASR + Visão por segmentos + Rostos + Indexação Vetorial) para um único vídeo específico.

### POST /api/photo/{photo_id}/analyze-all
- **Descrição:** Dispara a análise completa de IA (Visão + Rostos + Indexação Vetorial) para uma única foto específica.

### POST /api/project/open-folder-in-explorer
- **Descrição:** Abre o diretório de arquivos originais ou a pasta do arquivo selecionado diretamente no explorador nativo do sistema operacional (Windows Explorer).
- **Payload:** `{ "path": "caminho_do_arquivo_ou_pasta" }`

### POST /api/ingest/external-files
- **Descrição:** Registra e ingere uma lista de caminhos de arquivos externos in-place no projeto sem duplicação de dados no disco.
- **Payload:** `{ "paths": ["/caminho/video1.mp4", "/caminho/video2.mp4"], "project_id": 1 }`

---

## 8. Documentação Interativa Swagger

- Para documentações interativas completas das rotas HTTP, payloads e
  esquemas de dados, inicie a aplicação localmente e acesse a
  documentação gerada pelo FastAPI Swagger: 👉
  [**http://localhost:8000/docs**](http://localhost:8000/docs)
