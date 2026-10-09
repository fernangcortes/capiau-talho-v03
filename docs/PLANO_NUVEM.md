# Plano: CapIAu-Talho na nuvem (multi-máquina)

> Diagnóstico de 06/10/2026 e plano de migração. Objetivo: abrir o Talho em qualquer
> computador com `git pull` + um `.env` de poucas linhas, sem copiar `data/` à mão, e
> rodar "análises de teste" sem bagunçar o acervo de verdade.
>
> Preços e limites foram pesquisados em out/2026 a partir de resumos de busca. Confira
> nas páginas oficiais antes de contratar. Os números marcados com (?) não foram confirmados.

---

## 1. Diagnóstico: como está hoje

**Resumo:** o Talho não sincroniza nada entre máquinas. Tudo o que importa vive em `data/`
e em caminhos absolutos do HD externo. O que existe de "nuvem" é parcial:

| Componente | Status | Onde |
|---|---|---|
| Qdrant | **Só local embutido** (`QdrantClient(path=...)`). Não existe `QDRANT_URL`/`QDRANT_API_KEY` | `src/search/semantic.py:93`, `src/config.py:93` |
| Upload S3 de proxies de vídeo e crops de rosto | Parcial: funciona, mas o retorno é ignorado, não há retry e nada fica registrado no banco | `src/services/ingest.py:337`, `src/services/face_service.py:1160` |
| Leitura com fallback via URL pré-assinada | Parcial: gera o link **sem checar se o objeto existe** (`file_exists_in_s3` nunca é chamada), e o player recebe 404 | `src/api/routes/media.py:92`, `src/api/routes/faces.py:849` |
| Miniaturas, proxies de foto, waveforms e Qdrant no S3 | Não implementado (o `.env.example` diz que miniaturas sobem, mas não sobem) | — |
| Backup do SQLite no S3 | **Arriscado**: copia o `.db` vivo em modo WAL (escritas recentes no `-wal` ficam de fora), a chave é fixa e cada backup sobrescreve o anterior. Não há restore | `src/api/routes/projects.py:347` |
| `SyncService` | É só export/import de projeto em ZIP: perde colunas novas, sempre duplica o projeto, copia `filepath` absoluto | `src/services/sync.py` |
| Sync do SQLite entre máquinas | Não implementado | — |
| Variáveis `CAPIAU_DB_PATH` / `CAPIAU_EXPORTS_DIR` do `.env.example` | **Quebradas**: o código lê `capiau_DB`, `capiau_EXPORTS` etc. (minúsculas, nomes diferentes) | `src/config.py:86-93` |
| S3 com R2/B2/MinIO | Impossível sem mexer no código: não há `endpoint_url` | `src/services/s3_service.py` |
| Testes de nuvem | Inexistentes (nenhum teste de S3, de Qdrant remoto ou de backup) | `tests/` |

**Outros bugs encontrados:**
- `s3_service.py:6` importa `botocore` no topo, fora do `try`. Sem boto3, as rotas `media.py:95` e
  `faces.py:849` dão erro 500 em vez de desligar o S3.
- `get_bucket_total_size_gb` lista o bucket inteiro **a cada upload**, o que fica O(n²) com milhares de crops.
- A trava de originais é `"originals" in str(path)`: bloqueia qualquer caminho com essa palavra e
  deixa passar originais de outras pastas.
- O drive `F:/` está cravado no código como "acervo somente leitura" (`audio_stems.py:134`,
  `video_render/midia.py:116`, `audio_chain.py`).
- As chaves de API salvas pelo painel ficam **em texto puro** em `app_setting.value_json`.
  Se o banco subir para a nuvem sem tratamento, as chaves vão junto.
- O modo embutido do Qdrant tem trava de arquivo exclusiva. Por isso existe a dança
  `suspend_for_worker`, que deixa a busca fora do ar enquanto um worker roda. Um Qdrant
  servidor/nuvem resolve isso de graça.

### Inventário do que vive só na máquina

| Estado | Tamanho | Natureza | Destino na nuvem |
|---|---|---|---|
| `data/capiau.db` (~30 tabelas: projetos, transcrições palavra a palavra, timelines, rostos, embeddings de rosto em JSON, configurações, prompts) | dezenas a centenas de MB | estruturado, **insubstituível** | banco gerenciado |
| `data/qdrant.db/`: `capiau_making_of` (384d, MiniLM) e `capiau_images` (512d, CLIP) | centenas de MB | derivado, caro de recalcular | **Qdrant Cloud** |
| `data/proxies/` (vídeo, fotos `.webp`, `thumbnails/`) | GBs | derivado do original | object storage |
| `data/crops/`, `data/fontes/<proj>/` | pequeno | crops regeneráveis; fontes enviadas são originais | object storage |
| `data/audio_tratado/`, `data/exports/renders/` | GBs | caro / produto final | object storage (opcional) |
| `data/audio_cloud/cota_auphonic.json` | bytes | estado vivo | tabela no banco |
| `data/models/` (YuNet, SFace, ArcFace, CodeFormer, denoise), pesos do Laya (~680 MB), cache do HuggingFace | ~1–2 GB | baixável | script de bootstrap (com espelho opcional no bucket) |
| `data/cache/`, `data/logs/`, `data/venv312/`, `.venv` | variável | descartável | **não sincronizar** |
| Originais no HD externo (`F:/...`), com caminho absoluto em `video.filepath` / `photo.filepath` | TBs | insubstituível | **ficam locais**, com relink automático |
| `.env` + chaves `api.*_key` no banco | bytes | segredo | cofre / cifrado |

---

## 2. Arquitetura alvo

```
            ┌──────────────── Máquina A / Máquina B (igual) ────────────────┐
            │  FastAPI + UI  ·  cache local LRU (data/cache)  ·  HD externo │
            │  .env mínimo: DATABASE_URL, QDRANT_URL/KEY, R2_*, MASTER_KEY  │
            └───────┬───────────────────┬───────────────────┬───────────────┘
                    │                   │                   │
        Banco relacional         Qdrant Cloud (free)   Cloudflare R2 (S3)
     (Turso ou Neon, fase 4)    3 coleções, tenant =    proxies, thumbs, fotos,
     projetos, transcrições,     project_id, int8       crops, fontes, backups,
     timelines, rostos, runs                            dump de vetores
                    │
          GitHub Actions (cron): keep-alive do Qdrant + backup semanal
```

**Princípios**
1. **Uma fonte da verdade por tipo de dado.** Banco = metadados, Qdrant = vetores, R2 = binários.
   Nada de sincronizar arquivos `.db` por Drive/Dropbox, porque o WAL corrompe.
2. **Originais nunca sobem** (caro e lento). Sobem proxies e derivados. O original é encontrado
   em cada máquina por *volume + caminho relativo + hash*.
3. **Tudo que é derivado é regenerável.** Vetores e proxies têm backup, mas podem ser
   recalculados. O free tier do Qdrant **apaga o cluster após 4 semanas inativo**.
4. **O `.env` vira a única coisa a copiar** (5–6 linhas, guardadas num gerenciador de senhas).

---

## 3. Escolhas e por quê

### Vetores: Qdrant Cloud free tier ✅
- Limites do free: 1 nó com **1 GB de RAM, 0,5 vCPU e 4 GB de disco**, sem cartão. **Suspende após
  1 semana sem uso e apaga após 4 semanas.** Snapshots só manuais.
- Capacidade estimada para 384d: ~150–250 mil pontos tudo em RAM. Com **quantização scalar int8 +
  vetores originais `on_disk`**, ~400–600 mil. Isso cobre bem o caso "dezenas a poucas centenas de
  milhares", que é o atual.
- A troca no código é pequena: `QdrantClient(url=..., api_key=...)` tem a mesma API.
- Multitenancy: **3 coleções** (texto, imagem e, futuramente, rosto) com `project_id` no payload,
  indexado como `keyword` com `is_tenant=True`, em vez de uma coleção por projeto.
- O próximo degrau pago é caro (~US$ 50+/mês por GB de RAM (?)). Se estourar, o plano B é
  pgvector no mesmo Postgres ou um Qdrant próprio num VPS barato.
- **Migração:** o formato embutido **não** é compatível com snapshot de servidor. O caminho é um
  script `scroll` → `upsert` em lotes, que preserva os IDs UUIDv5 e os payloads.

### Binários: Cloudflare R2 ✅
- 10 GB grátis, **egress zero** (vídeo no player sai de graça), API S3, então o boto3 continua.
  Depois disso, ~US$ 0,015/GB-mês (100 GB ≈ US$ 1,50).
- Suporta `Range` + URL pré-assinada, então `<video>` faz streaming direto do bucket.
- Alternativa equivalente: Backblaze B2 (mais barato por TB, egress limitado a 3× o armazenado).
  Como o código vai aceitar `S3_ENDPOINT_URL`, trocar de um para o outro é só mudar o `.env`.

### Banco relacional: decisão na fase 4 (com prova de conceito antes)
São **580 chamadas `execute` em 52 arquivos**, com SQL específico de SQLite (`INSERT OR`,
`AUTOINCREMENT`, `PRAGMA`, `json_extract`). Isso pesa na escolha:

| | **Turso / libSQL (réplica embarcada)** | **Neon Postgres** |
|---|---|---|
| Mudança de código | **Mínima**: driver `libsql` compatível com `sqlite3`, mesmo dialeto | Grande: SQLAlchemy/Alembic e tradução de ~580 queries |
| Offline | Lê localmente; escrita offline ainda é recurso novo (?) | Não funciona offline |
| Free tier | 5 GB e 100 bancos. O sync de réplica pode exigir o plano Developer (US$ 4,99/mês) (?) | 0,5 GB/projeto (pode apertar com `dialogue_word`), escala a zero, não apaga |
| Experimentos | 1 banco por experimento (100 grátis) | **Branches** copy-on-write (10 grátis), excelentes para testes |
| Maturidade | Mais nova, com ressalvas de concorrência em threads | Postgres consolidado, ótimo para equipe futura |

**Recomendação:** começar com uma **prova de conceito de Turso** (1–2 dias), rodando a suíte de
testes com o driver `libsql`. Se passar, ele vira a fonte da verdade com custo de código baixo.
Se esbarrar em concorrência ou limites, migrar para **Neon** atrás de uma camada SQLAlchemy.
Supabase foi descartado: pausa o projeto após 1 semana sem uso e o free tier é pequeno.

### Segredos
As chaves de API do painel passam a ser **cifradas no banco** (Fernet), com a `CAPIAU_MASTER_KEY`
no `.env` ou no keyring do sistema. Assim elas sincronizam com o banco sem vazar em texto puro.
Infisical/Doppler são opcionais se um dia houver equipe.

---

## 4. Plano por fases

Cada fase entrega algo utilizável sozinha, com testes. A ordem prioriza o que destrava a segunda
máquina mais cedo.

### Fase 0 — Consertar o que existe (1–2 dias)
- [ ] `config.py`: aceitar `CAPIAU_DB_PATH`, `CAPIAU_EXPORTS_DIR` e afins (mantendo os nomes antigos como
      fallback) e alinhar o `.env.example` com os defaults reais dos modelos.
- [ ] `s3_service.py`:
  - [ ] mover o import de `botocore` para dentro do `try`;
  - [ ] aceitar `S3_ENDPOINT_URL` (R2/B2/MinIO);
  - [ ] guardar em cache o tamanho do bucket em vez de listar a cada upload;
  - [ ] trocar a trava de "originals" por uma lista explícita de prefixos permitidos.
- [ ] Fallback de leitura: só gerar URL pré-assinada se o objeto existir (`head_object` com cache).
- [ ] Backup do banco: usar `sqlite3.Connection.backup()` para um arquivo temporário consistente,
      gravar com chave datada (`backups/AAAA-MM-DD_HHMM.db`), manter as N últimas e criar a rota de **restore**.
- [ ] Testes com `moto` (S3 falso) para upload, fallback e backup.

### Fase 1 — Qdrant Cloud (2–3 dias) ⭐ pedido principal
- [ ] Criar o cluster free (região mais próxima disponível) e a API key.
- [ ] `config.py`: `QDRANT_URL` e `QDRANT_API_KEY`. Sem eles, continua no modo embutido (o dev offline segue funcionando).
- [ ] Fábrica única `get_qdrant_client()` usada por `semantic.py` e `image_semantic.py`.
- [ ] Ao criar as coleções: índice `project_id` (`keyword`, `is_tenant=True`), índices em `video_id`
      e `media_type`, quantização scalar int8 `always_ram` e vetores `on_disk`.
- [ ] `scripts/migrar_qdrant_nuvem.py`: lê a pasta local com `scroll` e grava com `upsert` em lotes na nuvem.
      É idempotente, porque os IDs UUIDv5 são determinísticos. Compara as contagens no final.
- [ ] Modo remoto: desligar a dança `suspend_for_worker`, porque workers e servidor podem acessar ao mesmo tempo.
- [ ] **Keep-alive**: workflow do GitHub Actions (`schedule`, a cada 3 dias) fazendo uma busca real
      na coleção. Isso evita a suspensão de 1 semana e a deleção em 4.
- [ ] **Backup de vetores**: o mesmo workflow, semanalmente, exporta os pontos (scroll) em
      `.parquet`/`.npz` para o R2. Restaurar = `upsert` de volta. Não depende de snapshot do free tier.
- [ ] Indicador na UI (painel de configurações): "Qdrant: nuvem ✓ / local / indisponível" e uso de RAM/pontos.
- [ ] Testes: o cliente remoto apontando para um Qdrant em Docker (`qdrant/qdrant`) no CI.

### Fase 2 — Binários no R2, endereçados por conteúdo (3–4 dias)
- [ ] Nova tabela `blob(id, kind, sha256, size, s3_key, created_at)` e colunas `proxy_blob_id`/`thumb_blob_id`
      em `video`/`photo`. O banco passa a **saber** o que está na nuvem.
- [ ] Chaves por hash: `proxies/<sha256>.mp4`, `thumbs/<sha256>.webp`. Assim a segunda máquina nunca reenvia o que já existe.
- [ ] Subir também: miniaturas, proxies de foto, crops, fontes do projeto, waveforms (opcional) e `audio_tratado` (opcional).
- [ ] Fila de upload persistente com retry (tabela `upload_queue`) no lugar do "dispara e esquece".
- [ ] Leitura: arquivo local → cache local → URL pré-assinada do R2 → regenerar a partir do original.
- [ ] Cache local com limite de tamanho (LRU) em `data/cache/blobs`.
- [ ] CORS no bucket (`Range`, `ETag`) e teste de seek no player com proxy remoto.
- [ ] Script `scripts/subir_acervo_r2.py` para enviar o que já existe hoje em `data/proxies`.

### Fase 3 — Mídia original portátil (2–3 dias)
- [ ] Tabela `volume(id uuid, label, read_only)`, com um arquivo `.capiau-volume` na raiz de cada HD.
- [ ] `video.volume_id` + `video.rel_path` + `video.content_hash` (hash parcial: início/meio/fim + tamanho,
      com xxh3). O `filepath` absoluto vira cache.
- [ ] Arquivo **local, não sincronizado** `data/machine.json`: `machine_id` e o mapa `volume_id → ponto de montagem`.
- [ ] Detecção automática ao iniciar e ao plugar o HD (Windows, macOS e Linux). Substitui
      `scripts/religar_hd_externo.py` e a varredura A–Z.
- [ ] Trocar o `F:/` cravado no código por "volume marcado `read_only`".
- [ ] Migração única: preencher o volume e o caminho relativo a partir dos `filepath` atuais.
- [ ] Sem o HD: o app trabalha só com proxies do R2 (decupagem, busca, timeline). Só o render final exige o original.

### Fase 4 — Banco relacional na nuvem (prova de conceito 1–2 dias, migração 3–10 dias)
- [ ] Versionar o schema (`PRAGMA user_version` ou Alembic) antes de qualquer coisa.
- [ ] Unificar o acesso: `src/db/operations.py` abre conexão sem WAL e sem timeout. Tudo deve passar por `get_db()`.
- [ ] **Prova de conceito Turso**: `get_db()` com o driver `libsql` (réplica embarcada `data/replica.db` +
      `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`). Rodar a suíte inteira e medir a latência de escrita.
- [ ] Se aprovado: migrar os dados (`sqlite3 .dump` → Turso), com sync ao iniciar, periódico e ao fechar.
- [ ] Se reprovado: SQLAlchemy Core + Alembic + Neon, convertendo por repositório e rodando os testes em SQLite e Postgres.
- [ ] **Trava de projeto** (lease): tabela `project_lock(project_id, machine_id, heartbeat)`. A UI avisa
      "aberto no computador X" para evitar duas máquinas escrevendo no mesmo projeto.
- [ ] Mover `cota_auphonic.json` para `app_setting`.

### Fase 5 — Segredos e ambiente reprodutível (1–2 dias)
- [ ] Chaves `api.*_key` cifradas (Fernet) no banco, migração das existentes e a chave mestra fora do banco.
- [ ] `pyproject.toml` + `uv.lock`: `uv sync` instala igual em qualquer máquina.
- [ ] `scripts/bootstrap.py` multiplataforma: confere o ffmpeg, baixa os modelos ONNX, os pesos do Laya e os
      embeddings do HF (com espelho opcional no R2), cria o `venv312` do OTIO no caminho certo por SO
      (`Scripts/` ou `bin/`) e valida as conexões (banco, Qdrant, R2).
- [ ] `docker-compose.yml`: remover o `--reload` de produção e adicionar um perfil opcional `qdrant-local`
      para desenvolvimento offline.
- [ ] Rota/painel **"Saúde da nuvem"**: status de cada serviço, uso dos free tiers e último backup.

### Fase 6 — Análises de teste isoladas (2–3 dias)
- [ ] Tabela `analysis_run(id, project_id, kind, params_json, models, cost_usd, status, created_at)`.
      Saídas de análise (temas, triagem, descrições, sistema 1) ganham `run_id`.
- [ ] "Promover" uma run a oficial ou apagá-la (`DELETE ... WHERE run_id=?` + filtro `run_id` no Qdrant).
- [ ] Qdrant: `run_id` no payload para runs experimentais e aliases de coleção para trocas grandes (ex.: novo modelo de embedding).
- [ ] Cache de respostas pagas (AssemblyAI, Deepgram, visão) por `(hash_do_áudio/frame, provedor, parâmetros)`,
      para não pagar duas vezes o mesmo experimento.
- [ ] Testes arriscados: um banco ou branch descartável (Turso: banco de teste; Neon: branch).

---

## 5. Custos estimados (sem as APIs de IA)

| Item | Começo | Com acervo maior |
|---|---|---|
| Qdrant Cloud free | US$ 0 | US$ 0 até ~500 mil pontos |
| Cloudflare R2 | US$ 0 (≤ 10 GB) | ~US$ 1,50 por 100 GB de proxies |
| Turso (ou Neon free) | US$ 0–4,99 | US$ 4,99 |
| GitHub Actions (keep-alive/backup) | US$ 0 | US$ 0 |
| **Total** | **US$ 0–5/mês** | **~US$ 5–10/mês** |

O custo real continua nas chamadas de IA. A Fase 6 (cache) também ajuda nisso.

## 6. Riscos

- **Deleção do Qdrant free após 4 semanas sem uso**: mitigada pelo keep-alive e pelo backup semanal de vetores no R2.
- **Banco online obrigatório** (se for Neon): sem internet, o app não abre o projeto. O Turso mitiga isso nas leituras.
- **Duas máquinas no mesmo projeto ao mesmo tempo**: mitigado pela trava de projeto da Fase 4.
- **Upload inicial dos proxies**: dezenas de GB levam horas. Rodar o script da Fase 2 de madrugada.
- **Operações Class A do R2** com milhares de thumbs pequenas: monitorar (1 milhão/mês grátis).

## 7. Ordem sugerida de execução

1. Fase 0 + Fase 1 → busca semântica já compartilhada entre máquinas.
2. Fase 2 + Fase 3 → abrir o projeto na outra máquina com proxies e relink automático.
3. Fase 4 → metadados na nuvem: fim do "copiar o `capiau.db`".
4. Fases 5 e 6 → ambiente de um comando e testes sem bagunça.

## 8. O que preciso de você para começar

- Criar as contas: **Qdrant Cloud** (cluster free) e **Cloudflare R2** (bucket + token S3). Turso/Neon só na Fase 4.
- Colocar as credenciais como segredos do repositório no GitHub (para o keep-alive) e no `.env` de cada máquina.
  **Nunca** enviá-las no chat nem em commit.
- Confirmar se o uso é "uma máquina por vez" (o caso mais simples) ou se pode haver duas abertas no mesmo projeto.
