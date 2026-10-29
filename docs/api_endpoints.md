# API REST do CapIAu-Talho

O backend é um servidor FastAPI (`uvicorn src.api.server:app`). Com ele em execução, tudo é servido na mesma porta.

| Item | Valor |
| :--- | :--- |
| URL base | `http://localhost:8000` (as rotas da API começam com `/api`) |
| Documentação interativa (Swagger) | `http://localhost:8000/docs` |
| Esquema OpenAPI | `http://localhost:8000/openapi.json` |
| Autenticação | Nenhuma por enquanto. O CORS aceita qualquer origem; use apenas em máquina ou rede confiável. |

A tabela completa de rotas, no fim desta página, é gerada automaticamente a partir do código. Antes dela há exemplos comentados dos fluxos mais usados (rostos, busca visual, áudio, waveforms, render e ingestão). Para parâmetros e esquemas exatos, consulte sempre o `/docs`.

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

### POST /api/media/similar-batch

- **Descrição:** Busca por similaridade em lote (visual ou textual) a
  partir de uma lista de itens de referência (fotos ou vídeos).

- **Payload:** `{ "project_id": 1, "items": [...], "search_type": "visual", "media_type_filter": "all", "limit": 12 }`.
  `items` aceita de 1 a 20 itens no formato `{ "kind": "photo" ou "video", "id": 1, "timestamp": null }`; `search_type` é `visual` ou `textual`;
  `media_type_filter` aceita `all`, `interview`, `broll` ou `photo`;
  `limit` vai de 1 a 60.

- **Resposta:** `{ results, mode_used, cohesion, warnings }`, com a
  explicação de por que cada resultado apareceu.

## 6. Miniaturas e tarefas em segundo plano

### POST /api/video/{video_id}/pause-thumbnails
- **Descrição:** Pausa a geração progressiva de miniaturas do vídeo.

### POST /api/video/{video_id}/resume-thumbnails
- **Descrição:** Retoma a geração progressiva de miniaturas do vídeo.

### POST /api/video/{video_id}/cancel-thumbnails
- **Descrição:** Cancela a geração progressiva de miniaturas do vídeo.

Os modelos de visão e demais opções de IA são lidos e gravados pelas rotas
de configurações (`GET /api/settings`, `PUT /api/settings/global`), listadas
na tabela completa mais abaixo.

## 7. Diagnóstico e tratamento de áudio

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

## 8. Formas de Onda de Áudio (Waveforms)

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

## 9. Render de Vídeo e Exportação da Timeline

### GET /api/timeline/{timeline_id}/export/{formato}
Gera e baixa o arquivo de intercâmbio de timeline nos formatos suportados (`otio`, `xml`, `edl`, `fcpxml`, etc.).

**Query params:**
- `use_proxies` (bool, default `false`): Quando `true`, as referências de mídia no arquivo gerado apontam para os proxies leves locais (`data/proxies/...`) com o sufixo `_proxy` no nome do arquivo, permitindo edição remota/offline em outros NLEs.

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
  "midia": { "ausentes": [], "originais_indisponiveis": [], "usa_proxies": false, "usa_proxy_fallback": false, "clipes_proxy": [] },
  "fidelidade": { "pode_renderizar": true, "avisos": [
      { "nivel": "warn", "codigo": "RENDER_COM_PROXIES", "titulo": "Exportando com proxies locais", "clipes": ["cut_1", "cut_2"] },
      { "nivel": "warn", "codigo": "JOELHO_COMPRESSOR", "titulo": "...", "clipes": ["cut_1"] } ] },
  "bloqueios": [],
  "assinatura": { "clipes": 6, "efeitos": 0, "duracao_total_s": 47.85 },
  "saida": { "diretorio": "...", "nome_arquivo_sugerido": "7v3_2026-08-24_1112.mp4" }
}
```

`assinatura` existe para o painel comparar a versão salva com a que está na tela: o auto-salvamento
grava em `localStorage`, então exportar sem salvar renderizaria a montagem anterior.

Avisos de nível `block` (mídia ausente, master sem original) **impedem** o render; `warn` só avisa (como `RENDER_COM_PROXIES`).

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
  "use_proxies": false,                  // força o uso explícito de proxies locais (sugere sufixo _proxy)
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

## 10. Ingestão por upload, análise individual e integração com o sistema

### POST /api/ingest/upload-files
- **Descrição:** Recebe arquivos enviados por arrastar e soltar (multipart/form-data) e os salva na pasta `originals/` para ingestão em segundo plano.
- **Campos do formulário:** `files` (um ou mais arquivos), `project_id` (padrão 1), `virtual_folder` (padrão `root`).

### POST /api/video/{video_id}/analyze-all
- **Descrição:** Dispara a análise completa de IA (ASR + Visão por segmentos + Rostos + Indexação Vetorial) para um único vídeo específico.

### POST /api/photo/{photo_id}/analyze-all
- **Descrição:** Dispara a análise completa de IA (Visão + Rostos + Indexação Vetorial) para uma única foto específica.

### POST /api/project/open-folder-in-explorer
- **Descrição:** Abre o diretório de arquivos originais ou a pasta do arquivo selecionado diretamente no explorador nativo do sistema operacional (Windows Explorer).
- **Payload:** `{ "path": "caminho_do_arquivo_ou_pasta" }`

### POST /api/ingest/external-files
- **Descrição:** Registra e ingere uma lista de caminhos de arquivos externos in-place no projeto sem duplicação de dados no disco.
- **Payload:** `{ "paths": ["/caminho/video1.mp4", "/caminho/video2.mp4"], "project_id": 1, "virtual_folder": "root" }`

---

---

## Todas as rotas

Gerado por `python scripts/gerar_docs_api.py`. Não edite o bloco abaixo à mão.

<!-- GERADO:API:INICIO -->

Total: 190 rotas em 9 grupos. A documentação interativa completa (parâmetros e esquemas) fica em `/docs` com o servidor em execução.

### AI Settings

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| GET | `/api/settings` | Valores resolvidos (default -> global -> projeto) com origem de cada um. Secrets mascarados. |
| PUT | `/api/settings/global` | Grava overrides globais (apenas as chaves enviadas). |
| POST | `/api/settings/global/reset` | Remove overrides globais (todos, ou apenas as chaves informadas). |
| POST | `/api/settings/preset` | Aplica um preset no escopo pedido. |
| PUT | `/api/settings/project/{project_id}` | Grava overrides do projeto (apenas as chaves enviadas). |
| POST | `/api/settings/project/{project_id}/reset` | Remove overrides do projeto (todos, ou apenas as chaves informadas). |
| GET | `/api/settings/prompts` | Lista todos os prompts do sistema com os valores resolvidos e suas origens. |
| PUT | `/api/settings/prompts/{prompt_id}` | Grava ou atualiza um override de prompt (global ou por projeto). |
| DELETE | `/api/settings/prompts/{prompt_id}` | Remove o override de um prompt, restaurando o padrão de fábrica. |
| GET | `/api/settings/registry` | Metadados do catálogo (sem valores): o painel da UI se auto-gera a partir daqui. |

### Entities

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| POST | `/api/entities` | Cria manualmente uma entidade (ex: cadastrar equipamento antes da análise). |
| POST | `/api/entities/bulk-status` | Aceita/rejeita entidades sugeridas pela extração de roteiro em massa (P2.5). |
| POST | `/api/entities/merge` | Funde duas entidades (E-A2): `source` some, `target` sobrevive com as menções |
| GET | `/api/entities/project/{project_id}` | Lista as entidades do projeto com contagem de menções. |
| POST | `/api/entities/project/{project_id}/backfill-legacy` | Migra rotulagens legadas (face.name e hack 'text:') para a camada de entidades. |
| POST | `/api/entities/project/{project_id}/enrich` | Dispara o re-enriquecimento das descrições: reescreve com os nomes confirmados |
| POST | `/api/entities/project/{project_id}/enrich/cancel` | Cancela a sincronização de descrições ativa do projeto. |
| DELETE | `/api/entities/project/{project_id}/enrich/cancel` | Cancela a sincronização de descrições ativa do projeto. |
| PATCH | `/api/entities/{entity_id}` | Edita uma entidade: nome/tipo/descrição/função/universo/vínculo/aliases. |
| DELETE | `/api/entities/{entity_id}` | Remove uma entidade e suas menções. |

### Faces

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| POST | `/api/faces/confirm-cluster` | Operador confirma manualmente TODOS os rostos de um grupo/cluster (Tier 4). |
| POST | `/api/faces/confirm-identity` | Operador confirma manualmente a identidade de uma face (Tier 4). |
| POST | `/api/faces/face` | Insere manualmente uma face ou objeto desenhado pelo usuario no frame/foto. |
| GET | `/api/faces/face/{face_id}` | Retorna detalhes completos de uma face com todos os reconhecimentos. |
| GET | `/api/faces/face/{face_id}/context-media` | Retorna mídias de contexto temporal (fotos da mesma rajada/momento ou janela temporal de vídeo). |
| POST | `/api/faces/face/{face_id}/enhance` | Restaura/realça o rosto em alta definição para desambiguação (crop do rosto). |
| POST | `/api/faces/face/{face_id}/label` | Rotula uma face ou cluster de faces inteiro, gerenciando conflitos. |
| POST | `/api/faces/face/{face_id}/precise` | Processa uma face com Tier 3 (InsightFace GPU) para maxima precisao. |
| POST | `/api/faces/face/{face_id}/refine` | Refina uma face com tiers superiores (Azure/AWS). |
| POST | `/api/faces/face/{face_id}/reject` | Marca uma face como rejeitada/nao relevante (nao e rosto) e opcionalmente especifica o objeto. |
| GET | `/api/faces/face/{face_id}/thumbnail` | Retorna o thumbnail da face, priorizando cache/crop_path para máxima velocidade. |
| POST | `/api/faces/photo/{photo_id}/detect` | Executa deteccao facial Tier 0 em uma foto. |
| GET | `/api/faces/photo/{photo_id}/faces` | Retorna rostos da foto com compatibilidade, excluindo detecções descartadas. |
| POST | `/api/faces/pipeline/install-insightface` | Instala o InsightFace e dependências de runtime (onnxruntime) no Python local. |
| GET | `/api/faces/pipeline/s3/status` | Retorna o status da integracao S3, tamanho do bucket e travas de seguranca. |
| GET | `/api/faces/pipeline/status` | Retorna status dos backends disponiveis no pipeline. |
| GET | `/api/faces/project/{project_id}/face-clusters` | Lista todos os grupos de rostos agrupados no projeto. |
| GET | `/api/faces/project/{project_id}/face-clusters/{cluster_id}/faces` | Retorna todas as faces individuais de um cluster com paths de midias para preview. |
| GET | `/api/faces/project/{project_id}/faces` | Retorna todas as faces do projeto com reconhecimento autoritativo. |
| POST | `/api/faces/project/{project_id}/faces/cluster` | Clusteriza todas as faces do projeto usando DBSCAN. |
| POST | `/api/faces/project/{project_id}/faces/dissociate` | Remove a identificação de um conjunto de faces, voltando a serem desconhecidas. |
| POST | `/api/faces/project/{project_id}/faces/merge` | Mescla dois clusters em um unico. |
| POST | `/api/faces/project/{project_id}/faces/reassign` | Reatribui faces de forma unitaria (desambiguacao manual). |
| POST | `/api/faces/project/{project_id}/faces/reset-unconfirmed` | Reseta nomes e cluster_ids de faces nao confirmadas manualmente pelo usuario. |
| POST | `/api/faces/project/{project_id}/names/delete` | Remove a associação de um nome/falante globalmente no projeto (faces, falas, pessoa, entidades). |
| POST | `/api/faces/project/{project_id}/names/merge` | Mescla as ocorrências de um nome (src_name) em outro (dest_name). |
| POST | `/api/faces/project/{project_id}/names/rename` | Renomeia uma pessoa/falante globalmente no projeto, atualizando rostos, falas e entidades. |
| GET | `/api/faces/project/{project_id}/people` | Retorna todas as pessoas identificadas no projeto. |
| POST | `/api/faces/project/{project_id}/people` | Cria uma nova pessoa no projeto. |
| POST | `/api/faces/project/{project_id}/recover-photo-faces` | Dispara em background: detecção facial nas fotos sem detecção + re-clustering |
| GET | `/api/faces/project/{project_id}/unlabeled-faces` | Retorna rostos nao rotulados (ou placeholders) para desambiguacao rapida, ordenados cronologicamente. |
| GET | `/api/faces/video/{video_id}/faces` | Retorna rostos do video com compatibilidade, excluindo detecções descartadas. |
| POST | `/api/faces/video/{video_id}/frame/detect` | Executa deteccao facial Tier 0 em um frame de video. |

### Media & Ingestion

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| GET | `/api/audio/glossario` | Serve o glossário de áudio para a interface (contrato N1). |
| GET | `/api/audio/nuvem/campos` | Grade viva dos campos ajustáveis do Auphonic (contratos L1 e L2/L4). |
| GET | `/api/audio/nuvem/cota` | Retrato da cota gratuita mensal do Auphonic (contratos H4 e H6). |
| GET | `/api/audio/tratado/{video_id}/{chain_hash}.wav` | Serve o WAV tratado para o player (A/B do contrato F4). |
| GET | `/api/conversions` | Retorna o progresso em tempo real das conversões de vídeo/foto em execução. |
| POST | `/api/editor/heartbeat` | Reporta atividade do usuário no editor para desacelerar tarefas de segundo plano. |
| POST | `/api/ingest/external` | Varre uma pasta ou arquivo externo inserindo os caminhos em formato Link (in-place) para uma pasta virtual. |
| POST | `/api/ingest/external-files` | Ingere múltiplos arquivos externos in-place em background para uma pasta virtual. |
| POST | `/api/ingest/select-files` | Abre uma caixa de diálogo nativa do Windows para seleção múltipla de arquivos de mídia se suportado. |
| POST | `/api/ingest/select-folder` | Abre uma caixa de diálogo nativa do Windows para seleção de diretório se suportado. |
| POST | `/api/ingest/upload-files` | Recebe arquivos enviados via drag & drop e salva na pasta originals/ para ingestão. |
| POST | `/api/media/batch-move-to-bin` | Move múltiplas mídias em lote para uma pasta virtual. |
| POST | `/api/media/cancel-all-analyses` | Cancela todas as análises de visão/reanálises em andamento no projeto ou globalmente. |
| GET | `/api/media/failed-count` | Retorna o número de vídeos afetados por falhas visuais ou status de erro. |
| POST | `/api/media/move-to-bin` | Move uma mídia individual para uma pasta virtual. |
| GET | `/api/media/photo/{photo_id}/similar` | Fotos visualmente próximas via CLIP local (E2.B6). |
| POST | `/api/media/reanalyze-failed` | Dispara a reanálise em lote das mídias afetadas por falha visual. |
| POST | `/api/media/similar-batch` | Busca de mídias por similaridade multimodal (visual ou textual) em lote (E2.B6). |
| GET | `/api/media/video/{video_id}/similar` | Trechos/fotos visualmente próximos do keyframe indexado mais perto do timestamp (E2.B6). |
| PATCH | `/api/media/{media_type}/{media_id}/metadata` | Atualiza campos de metadados editoriais, data de gravação/diária e pasta virtual da mídia. |
| POST | `/api/media/{media_type}/{media_id}/rotate` | Gira a foto ou vídeo em passos de 90 graus (0, 90, 180, 270). |
| DELETE | `/api/photo/{photo_id}` | Exclui a foto do banco e remove o proxy físico WebP. |
| POST | `/api/photo/{photo_id}/analyze-all` | Executa o pipeline completo de IA (Visão + Rostos + Indexação Vetorial) para uma única foto. |
| POST | `/api/photo/{photo_id}/analyze-vision` | Inicia a análise visual e tags por IA da foto bastidores de forma síncrona. |
| PATCH | `/api/photo/{photo_id}/category` | Correção humana de categoria da foto. Fotos de rajada compartilham a mesma |
| GET | `/api/photo/{photo_id}/file` | Retorna uma imagem exibível no browser. |
| DELETE | `/api/photo/{photo_id}/proxy` | Cancela tarefas e apaga o arquivo proxy WebP físico da foto no disco. |
| POST | `/api/photo/{photo_id}/retry` | Reinicia a geração de proxy e análise de uma foto individual. |
| GET | `/api/photo/{photo_id}/thumbnail` | Miniatura pequena da foto, gerada uma vez e cacheada em disco. |
| PATCH | `/api/photo/{photo_id}/title` | Atualização manual/humana do título da foto. |
| GET | `/api/photos` | Lista todas as fotos e injeta caminhos relativos de proxies se existirem. |
| POST | `/api/project/open-folder-in-explorer` | Abre um diretório ou a pasta do arquivo no Windows Explorer nativo. |
| POST | `/api/project/open-proxies-folder` | Abre a pasta local de proxies no Windows Explorer. |
| POST | `/api/project/{project_id}/analyze-all-vision` | Analisa de forma assíncrona todas as mídias pendentes ou todas (se force=True) de visão, aplicando detecção facial e burst-sequencing de fotos. |
| GET | `/api/project/{project_id}/bins` | Retorna a lista de todas as pastas virtuais (bins) do projeto. |
| POST | `/api/project/{project_id}/bins` | Cria ou atualiza uma pasta virtual no projeto. |
| DELETE | `/api/project/{project_id}/bins` | Remove uma pasta virtual da biblioteca sem apagar nenhum arquivo físico. |
| PATCH | `/api/project/{project_id}/bins/color` | Altera a cor temática do bin. |
| PATCH | `/api/project/{project_id}/bins/rename` | Renomeia uma pasta virtual e propaga para subpastas e mídias. |
| GET | `/api/project/{project_id}/regenerate-titles` | Dispara a regeneração em lote dos títulos executivos curtos (3 a 6 palavras) via IA. |
| POST | `/api/project/{project_id}/regenerate-titles` | Dispara a regeneração em lote dos títulos executivos curtos (3 a 6 palavras) via IA. |
| POST | `/api/project/{project_id}/relink` | Varre uma pasta raiz com subpastas para relincar automaticamente mídias desconectadas. |
| POST | `/api/project/{project_id}/retry-failed` | Efetua retry em lote de todas as mídias falhas (status error) ou com proxies físicos ausentes. |
| POST | `/api/project/{project_id}/scan-watch` | Escaneia a pasta watch/ em background e registra os novos arquivos. |
| POST | `/api/project/{project_id}/transcribe-all` | Inicia transcrição ASR em lote para todos os depoimentos pendentes do projeto. |
| POST | `/api/project/{project_id}/transcribe-worker` | Lança o worker de transcrição em PROCESSO SEPARADO e devolve o PID. |
| GET | `/api/project/{project_id}/triage/review` | Mídias cuja triagem merece revisão humana: confiança abaixo de |
| POST | `/api/projects/{project_id}/generate-waveforms` | Gera waveforms em background para todos os vídeos cadastrados no projeto. |
| POST | `/api/projects/{project_id}/relink` | Varre um diretório recursivamente buscando arquivos originais para reconectar |
| POST | `/api/task/{task_key}` | Remove ou cancela a tarefa da lista de progresso em segundo plano. |
| DELETE | `/api/task/{task_key}` | Remove ou cancela a tarefa da lista de progresso em segundo plano. |
| POST | `/api/task/{task_key}/cancel` | Cancela qualquer tarefa em segundo plano via seu task_key. |
| DELETE | `/api/task/{task_key}/cancel` | Cancela qualquer tarefa em segundo plano via seu task_key. |
| DELETE | `/api/video/{video_id}` | Deleta o vídeo do banco e apaga seu proxy físico correspondente. |
| POST | `/api/video/{video_id}/analyze-all` | Executa o pipeline completo de IA (ASR + Visão + Rostos + Indexação Vetorial) para um único vídeo. |
| POST | `/api/video/{video_id}/analyze-vision` | Inicia a decupagem visual multimodal do B-roll via OpenRouter Vision. |
| GET | `/api/video/{video_id}/audio/analysis` | Pre-analise de audio do clipe (plano de ajustes de áudio, não versionado, secao 5). |
| POST | `/api/video/{video_id}/audio/render` | Aplica a cadeia ffmpeg e gera o WAV tratado (Tipo B, secao 6 do plano). |
| GET | `/api/video/{video_id}/audio/render/{chain_hash}` | Estado do render (contrato F2): status, path, progresso na tela de Tarefas |
| POST | `/api/video/{video_id}/cancel-conversion` | Cancela o processo ativo de codificação ou análise visual de um vídeo. |
| POST | `/api/video/{video_id}/cancel-thumbnails` | Cancela a geração progressiva de miniaturas de um vídeo. |
| PATCH | `/api/video/{video_id}/category` | Correção humana de categoria: persiste com confiança 1.0, registra o |
| POST | `/api/video/{video_id}/crucial-moments` | Adiciona, remove ou substitui momentos cruciais de um vídeo. |
| POST | `/api/video/{video_id}/hover-duration` | Define ou limpa a duração customizada de hover play para um vídeo específico. |
| GET | `/api/video/{video_id}/metadata-history` | Versões anteriores da decupagem editorial, mais recente primeiro. |
| POST | `/api/video/{video_id}/metadata-history/{history_id}/restore` | Restaura uma versão arquivada. A versão atual é arquivada antes, então dá para voltar. |
| POST | `/api/video/{video_id}/override-status` | Permite ao usuário alternar manualmente o status de uma mídia entre 'error' e 'analyzed'. |
| PUT | `/api/video/{video_id}/override-status` | Permite ao usuário alternar manualmente o status de uma mídia entre 'error' e 'analyzed'. |
| POST | `/api/video/{video_id}/pause-thumbnails` | Pausa a geração progressiva de miniaturas de um vídeo. |
| DELETE | `/api/video/{video_id}/proxy` | Cancela conversões e apaga o arquivo proxy MP4 físico do disco. |
| POST | `/api/video/{video_id}/relink` | Relinca o caminho do arquivo de vídeo original com um novo arquivo no disco. |
| POST | `/api/video/{video_id}/resume-thumbnails` | Retoma a geração progressiva de miniaturas de um vídeo. |
| POST | `/api/video/{video_id}/retry` | Reinicia a codificação de proxy de um vídeo individual. |
| GET | `/api/video/{video_id}/stream` | Retorna o arquivo de vídeo original ou proxy para streaming no player/card. |
| GET | `/api/video/{video_id}/thumbnail` |  |
| POST | `/api/video/{video_id}/thumbnail` | Extrai e define uma miniatura específica no timestamp fornecido. |
| GET | `/api/video/{video_id}/thumbnail-at` | Retorna o thumbnail do vídeo no timestamp fornecido com suporte a carregamento progressivo e extração sob demanda. |
| PATCH | `/api/video/{video_id}/title` | Atualização manual/humana do título executivo do vídeo. |
| POST | `/api/video/{video_id}/transcribe` | Inicia a transcrição ASR AssemblyAI e indexação semântica em background. |
| GET | `/api/videos` | Lista todos os vídeos cadastrados no projeto. |
| GET | `/api/videos/{video_id}/waveform` | Retorna os picos Min/Max normalizados (-1.0 a 1.0) do arquivo de áudio/vídeo. |

### Modelos locais

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| GET | `/api/modelos` |  |
| POST | `/api/modelos/{modelo_id}/baixar` |  |

### Narratives & Search

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| GET | `/api/agent/models` | Retorna os modelos de agente de edição configurados e o padrão do sistema (Fase 1). |
| POST | `/api/project/cluster-themes` | Dispara processamento de clustering de temas em background. |
| POST | `/api/project/{project_id}/chat` | Interface chatbot RAG (legado) ou Agente de Edição ativo (se timeline for enviada). |
| POST | `/api/project/{project_id}/facets/backfill-palette` | Backfill de paleta/temperatura de cor das FOTOS (E2.D2) a partir dos proxies locais. |
| POST | `/api/project/{project_id}/facets/backfill-shot-scale` | Backfill das facetas visuais (E2.D1/D3) para o acervo JÁ indexado. |
| POST | `/api/render/revelar` | Abre o gerenciador de arquivos com o arquivo renderizado SELECIONADO. |
| GET | `/api/search` | Busca híbrida inteligente cruzando metadados relacionais e Qdrant vetorial. |
| POST | `/api/search/categorize` | Agrupa os resultados da busca em categorias semânticas via LLM. |
| POST | `/api/search/reindex` | Re-embeda todo o acervo com o modelo de embeddings atual (após troca de modelo). |
| GET | `/api/search/visual` | Busca visual pura por CLIP local (texto → imagem, sem custo de API), com facetas. |
| POST | `/api/theme/segment` | Associa um trecho de vídeo a um tema narrativo. |
| DELETE | `/api/theme/segment/{segment_id}` | Remove uma associação de tema segmentado. |
| GET | `/api/theme/{theme_id}/segments` | Retorna os trechos exatos (mídia + intervalo de tempo) vinculados a um tema. |
| GET | `/api/themes` | Retorna os temas catalogados com contagem de segmentos (trechos com timecode). |
| GET | `/api/timeline` | Retorna todas as timelines cadastradas do projeto. |
| POST | `/api/timeline` | Salva um novo rascunho de timeline (formato v2 multipista). |
| POST | `/api/timeline/ai-suggest` | Analisa o corte ATUAL da timeline (transcrições dos trechos, descrições visuais, |
| POST | `/api/timeline/import` | Importa um arquivo de timeline (.otio/.xml/.edl) e recria a timeline no projeto. |
| GET | `/api/timeline/{timeline_id}` | Carrega uma timeline salva (normalizada para o formato v2 com trilhas e posições). |
| GET | `/api/timeline/{timeline_id}/export/{export_format}` | Exporta a timeline em formato XML/EDL/OTIO e retorna o arquivo para download. |
| POST | `/api/timeline/{timeline_id}/render` | Valida, recusa em bloqueio e ENFILEIRA o render -- nunca segura o request. |
| POST | `/api/timeline/{timeline_id}/render/preflight` | Diagnóstico do modal de exportação: NÃO renderiza nada. |
| GET | `/api/timeline/{timeline_id}/render/ultimo` | Resultado do último render, para o modal reabrir com estado. |
| GET | `/api/video/{video_id}/diarization-clues` | Calcula e retorna pistas de diarização baseadas em silêncios, perguntas e rostos. |
| POST | `/api/video/{video_id}/edit-dialogue` | Atualiza o diálogo em um trecho específico e re-indexa no Qdrant. |
| POST | `/api/video/{video_id}/rename-speaker` | Renomeia um falante local ou globalmente e atualiza o índice semântico. |
| POST | `/api/video/{video_id}/split-transcript` | Divide a fala em um timestamp específico e atualiza falantes subsequentes. |
| GET | `/api/video/{video_id}/transcript` | Retorna a transcrição interativa agrupada por blocos de diálogos e palavras individuais. |
| GET | `/api/video/{video_id}/vision` | Retorna descrições de frames de B-roll enriquecidas com rostos/objetos do banco de dados (tolerância 5.0s). |

### Projects

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| DELETE | `/api/docs/{doc_id}` | Remove um documento de contexto e limpa seus vetores associados. |
| POST | `/api/onboarding/api-key` | Salva a chave de API fornecida no onboarding nas configurações globais. |
| POST | `/api/onboarding/chat` | Chat inteligente de onboarding com IA em nuvem ou inteligência especializada nativa. |
| POST | `/api/onboarding/chat/stream` | Mesmo chat de /api/onboarding/chat, com o texto chegando aos poucos (Server-Sent Events). |
| POST | `/api/project/backup-db` | Faz backup manual do arquivo de banco de dados SQLite para o S3. |
| POST | `/api/project/import` | Recebe um ZIP exportado e reconstrói o projeto, mídias e índices vetoriais. |
| GET | `/api/project/{project_id}/docs` | Retorna a lista de documentos de contexto cadastrados do projeto. |
| POST | `/api/project/{project_id}/docs` | Faz upload de um documento de roteiro/pauta e indexa no Qdrant. |
| PUT | `/api/project/{project_id}/drive-link` | Atualiza o link do Google Drive de referência do projeto. |
| POST | `/api/project/{project_id}/export` | Agrupa metadados e arquivos de mídia do projeto em um arquivo ZIP para download. |
| GET | `/api/project/{project_id}/fonts` | Fontes enviadas para o projeto: [{familia, arquivo, tamanho, url}]. |
| POST | `/api/project/{project_id}/fonts` | Guarda um arquivo de fonte (.ttf/.otf/.woff/.woff2) no projeto. |
| GET | `/api/project/{project_id}/fonts/{arquivo}` |  |
| DELETE | `/api/project/{project_id}/fonts/{arquivo}` |  |
| PUT | `/api/project/{project_id}/objetivo` | Objetivo do projeto (ex.: 'making of do longa MONSTRO'). A triagem e a Laya leem |
| GET | `/api/project/{project_id}/speakers` | Retorna lista consolidada de falantes e rostos rotulados do projeto. |
| GET | `/api/projects` | Retorna uma lista com todos os projetos cadastrados. |
| POST | `/api/projects` | Cria um novo projeto de documentário ou making of. |
| DELETE | `/api/projects/{project_id}` | Deleta um projeto e todas as suas mídias associadas no SQLite (em cascata). |

### Scenes

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| POST | `/api/docs/{doc_id}/extract-structure` | Dispara a extração estruturada em background. IO-bound (chamadas HTTP |
| GET | `/api/docs/{doc_id}/extraction` | Última rodada de extração deste documento (status, custo, estratégia usada). |
| GET | `/api/docs/{doc_id}/structure-preview` | Roda a detecção de formato do roteiro sem gastar API (a menos que llm=true), |
| GET | `/api/project/{project_id}/scenes` |  |
| POST | `/api/scenes/bulk-status` | Aceita/rejeita cenas sugeridas em massa (curadoria da aba Docs). |

### Sistema

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| GET | `/api/health` | Retorna o status de saúde do backend: SQLite, Qdrant, Hardware/GPU e porta em execução. |

<!-- GERADO:API:FIM -->
