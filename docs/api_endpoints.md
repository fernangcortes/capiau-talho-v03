# 🔌 Detalhamento das APIs de Visão e Faces

Abaixo estão listadas as rotas do backend FastAPI que gerenciam o fluxo
de detecções, desambiguação e anotações do CapIAu-Talho:

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

## 7. Documentação Interativa Swagger

- Para documentações interativas completas das rotas HTTP, payloads e
  esquemas de dados, inicie a aplicação localmente e acesse a
  documentação gerada pelo FastAPI Swagger: 👉
  [**http://localhost:8000/docs**](http://localhost:8000/docs)
