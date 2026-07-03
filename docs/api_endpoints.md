# 🔌 Detalhamento das APIs de Visão e Faces

Abaixo estão listadas as rotas do backend FastAPI que gerenciam o fluxo de detecções, desambiguação e anotações do CapIAu-Talho:

---

## 1. Rotulação e Resolução de Conflitos

### `POST /api/faces/face/{face_id}/label`
* **Descrição:** Atribui um nome à detecção facial. Se a detecção pertencer a um cluster/grupo, aplica o nome a todas as faces do mesmo grupo.
* **Payload:**
  ```json
  {
    "name": "Nome da Pessoa/Objeto"
  }
  ```
* **Resolução de Conflitos:** Se o nome fornecido já estiver associado a outro cluster, a API retorna um status `conflict` com os IDs dos clusters conflitantes, permitindo que o frontend inicie uma modal de desambiguação para fusão manual (`merge`) ou reatribuição (`reassign`).

---

## 2. Fusão de Grupos e Reatribuição de Rostos

### `POST /api/faces/project/{project_id}/faces/merge`
* **Descrição:** Une por completo o cluster de origem ao de destino.
* **Payload:**
  ```json
  {
    "src_cluster_id": int,
    "dest_cluster_id": int,
    "name": "Nome Confirmado"
  }
  ```

### `POST /api/faces/project/{project_id}/faces/reassign`
* **Descrição:** Transfere individualmente apenas as detecções selecionadas de um grupo para o grupo correto.
* **Payload:**
  ```json
  {
    "face_ids": [12, 15, 23],
    "target_cluster_id": int,
    "target_name": "Nome"
  }
  ```

---

## 3. Rejeição e Catalogação de Objetos

### `POST /api/faces/face/{face_id}/reject`
* **Descrição:** Descarta uma detecção de rosto errônea.
  * Se nenhum nome for fornecido (ou deixado em branco), a detecção é rotulada como `"Não Relevante"` e seu status é atualizado para `rejected`, sendo totalmente ignorada nos algoritmos de clustering e de enriquecimento RAG.
  * Se um nome de objeto for fornecido (ex: `Abajur`), a detecção é arquivada como `rejected` (para não poluir o clustering de pessoas), mas o nome do objeto é persistido no banco de dados para indexação na busca semântica e enriquecimento textual de B-rolls.
* **Payload (Opcional):**
  ```json
  {
    "name": "Nome do Objeto"
  }
  ```

---

## 4. Desenho de Caixas Manuais (Drag-and-Draw)

### `POST /api/faces/face`
* **Descrição:** Permite criar uma nova marcação retangular nas coordenadas normalizadas do vídeo ou da foto, permitindo indexar elementos e objetos personalizados do set.
* **Payload:**
  ```json
  {
    "project_id": 1,
    "video_id": 2, // Opcional
    "photo_id": null, // Opcional
    "timestamp": 12.5, // Opcional
    "bounding_box": [0.12, 0.34, 0.25, 0.45], // [x, y, w, h] normalizados de 0.0 a 1.0
    "name": "Nome do Objeto/Pessoa"
  }
  ```

---

## 5. Endpoints Relacionados a Projetos e Mídias
* Para documentações interativas completas das rotas HTTP, payloads e esquemas de dados, inicie a aplicação localmente e acesse a documentação gerada pelo FastAPI Swagger:
  👉 **[http://localhost:8000/docs](http://localhost:8000/docs)**
