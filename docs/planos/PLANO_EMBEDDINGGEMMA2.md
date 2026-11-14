# Plano — EmbeddingGemma 2 lado a lado com a busca atual

> Criado em 06/10/2026. Objetivo: testar o `google/embeddinggemma-2` **antes** de adotá-lo e,
> depois, manter os dois motores de busca convivendo, com o usuário escolhendo qual usa.
> Nada aqui substitui o que existe: o motor atual continua sendo o padrão até os testes
> provarem o contrário.

---

## Os dois motores

| | **Clássico** (hoje) | **Gemma 2** (novo) |
|---|---|---|
| Falas, descrições, docs | MiniLM multilíngue, 384d | EmbeddingGemma 2, 768d (ou 512/256) |
| Imagens / keyframes | CLIP ViT-B-32, 512d | o mesmo EmbeddingGemma 2 |
| Espaços vetoriais | 2 separados (não comparáveis) | 1 só (texto, imagem, vídeo, áudio) |
| Coleções Qdrant | `capiau_making_of`, `capiau_images` | `capiau_making_of__eg2`, `capiau_images__eg2` |
| RAM aproximada (fp32, CPU) | ~0,5 GB texto + ~1 GB CLIP | ~1 GB só texto, ~1,8 GB texto+imagem, ~3 GB completo |

As coleções antigas **não mudam de nome nem de conteúdo**. O Gemma 2 ganha coleções próprias,
no mesmo cliente Qdrant (o modo arquivo só aceita um cliente por caminho).

---

## Visão geral das fases

| Fase | Entrega | Precisa dos seus arquivos? |
|---|---|---|
| **0** | Bancada de comparação (script só-leitura + conjunto de teste) | Só para a rodada real |
| **1** | Camada de motores + indexação dupla + troca por configuração | Não (testes com motor falso) |
| **2** | Interface: seletor de motor e modo "Comparar" A/B com 👍/👎 | Não |
| **3** | Recursos que só o Gemma 2 tem (busca por som, por trecho de vídeo, busca unificada) | Sim, para validar |
| **4** | (Opcional) Migrar escala de plano, rajadas e beats do CLIP | Sim |

A Fase 0 é o portão: se o Gemma 2 não ganhar nos seus dados, as fases 2–4 não acontecem e
a Fase 1 fica desligada (custo zero para quem não ativa).

---

## Fase 0 — Bancada de testes (antes de mexer no app)

### 0.1 Script `scripts/embeddings_comparar.py`

Mesmo espírito de `scripts/asr_comparar.py`: **só lê**, nunca grava no banco nem no Qdrant
do app. Monta um índice temporário em memória para cada motor e mede:

| Métrica | O que diz |
|---|---|
| Recall@5 e Recall@10 | o trecho certo apareceu entre os primeiros? |
| MRR@10 | em que posição ele apareceu (quanto mais alto, melhor) |
| Latência por consulta | tempo de resposta da busca na CPU |
| Vazão de indexação | itens por segundo (impacta o worker de lote) |
| Tempo de carga do modelo | impacta a carência `WORKER_HANDOFF_GRACE_S` (hoje 120 s) |
| Pico de RAM | se cabe junto com o resto do app |

Variações testadas no Gemma 2: dimensão 768 / 512 / 256, e fp32 vs bf16 na CPU
(fp16 fica proibido: o model card avisa que gera NaN silencioso).

Saída: `data/cache/embeddings_comparacao/<data>.json` + um resumo em Markdown legível no celular.

Uso previsto:
```
set PYTHONPATH=. && .venv\Scripts\python.exe scripts\embeddings_comparar.py --conjunto sintetico
set PYTHONPATH=. && .venv\Scripts\python.exe scripts\embeddings_comparar.py --conjunto acervo --project 3
set PYTHONPATH=. && .venv\Scripts\python.exe scripts\embeddings_comparar.py --conjunto ouro --arquivo tests\fixtures\embeddings_ouro\consultas.jsonl
```

### 0.2 Três conjuntos de teste

1. **Sintético** (pode ser montado já, sem seus arquivos) — `tests/fixtures/embeddings_ouro/`:
   ~60 trechos de "entrevista" fictícia em português (com gíria, oralidade, erros de ASR),
   ~20 descrições de B-roll e as poucas imagens e o vídeo curto que já existem em
   `tests/fixtures` (6 imagens, 1 mp4). Cada consulta
   aponta o trecho esperado. Serve para provar que o script funciona e dar um primeiro sinal.
   Limitação: não substitui o acervo real.

2. **Acervo (automático)** — gerado a partir do seu banco: sorteia N trechos de fala e
   descrições já existentes, pede ao LLM que já está configurado uma paráfrase curta "do jeito
   que um editor buscaria" e usa o trecho original como resposta esperada. Não precisa
   escrever nada à mão; roda na sua máquina.

3. **Ouro (manual)** — as buscas que você de fato faz. Formato de uma linha por consulta:
   ```json
   {"consulta": "diretor falando do orçamento apertado", "esperados": [{"tipo": "fala", "video_id": 517, "t": 312.0}]}
   ```
   Dá para ir anotando **do celular**, num bloco de notas, no formato simples
   `consulta → vídeo / minuto`, que eu converto depois.

### 0.3 Critério de decisão (proposto, ajustável)

| Critério | Para seguir com o Gemma 2 |
|---|---|
| Recall@10 em falas (acervo + ouro) | ≥ clássico + 5 pontos |
| Recall@10 em imagens por texto | ≥ CLIP (empate já vale, pelo espaço unificado) |
| Latência de busca | ≤ 300 ms por consulta na CPU |
| RAM | cabe com o app aberto sem swap |
| Indexação | no máximo 2× mais lenta que hoje |

Se só a dimensão 768 passar, fica 768; se 512 ou 256 passarem, adota a menor (economia no Qdrant).

---

## Fase 1 — Os dois motores convivendo

### 1.1 Camada de motores — `src/search/motores_embedding.py` (novo)

Interface única, sem o resto do código saber qual modelo está por trás:

```python
class MotorEmbedding:
    chave: str              # "classico" | "gemma2"
    dim_texto: int
    dim_imagem: int
    colecao_texto: str
    colecao_imagem: str
    def consulta(self, texto) -> np.ndarray: ...
    def documento(self, texto, titulo=None) -> np.ndarray: ...
    def imagem(self, pil_img) -> np.ndarray: ...
    def consulta_para_imagem(self, texto) -> np.ndarray: ...
```

- **Clássico**: embrulha exatamente o que `SemanticSearch` e `ImageSearch` já fazem (MiniLM e
  CLIP). Comportamento idêntico, verificado por teste.
- **Gemma 2**: carga preguiçosa e por modalidade (`config_kwargs` sem áudio/visão quando não
  precisa), fp32 na CPU, `truncate_dim` + `normalize_embeddings=True`, prefixos de tarefa:
  - consulta: `prompt_name="SearchQuery"`
  - documento: `title: {nome do vídeo/doc} | text: {trecho}`
  - imagem/vídeo/áudio: sem prefixo

### 1.2 Configurações (`settings_registry.py`)

| Chave | Valores | Padrão | Observação |
|---|---|---|---|
| `search.motor` | `classico`, `gemma2`, `comparar` | `classico` | qual motor responde às buscas |
| `search.indexar_gemma2` | sim/não | não | liga a indexação dupla |
| `search.gemma2_dim` | 768, 512, 256 | resultado da Fase 0 | trocar exige reindexar as coleções `__eg2` |

Se `search.motor = gemma2` mas a coleção `__eg2` estiver vazia ou o modelo não carregar,
a busca **cai para o clássico** e avisa na interface — nunca devolve vazio em silêncio.

### 1.3 Indexação dupla

Com `search.indexar_gemma2` ligado, cada ponto que hoje vai para o Qdrant passa a ir para as
duas coleções (falas, descrições de B-roll, fotos, docs, anotações, keyframes). Pontos de
entrada a ajustar: `SemanticSearch.index_*`, `ImageSearch.index_*` e os reindexadores de
`sync.py`. Trocar de motor depois é instantâneo, porque os dois índices já existem.

Custo: tempo de indexação somado dos dois motores. Por isso fica desligado por padrão.

### 1.4 Preencher o Gemma 2 para o que já foi analisado — `scripts/reindexar_gemma2.py`

Lê transcrições e descrições **do SQLite** (como o `sync.py` já faz) e grava só nas coleções
`__eg2`. **Não chama ASR nem LLM de visão de novo: custo de API zero.** Para imagens, usa os
keyframes em cache; os que faltarem são re-extraídos com ffmpeg localmente. Respeita a trava
do Qdrant (roda como worker de lote, com `suspend_for_worker`). Retomável: pula pontos que já
existem.

### 1.5 O que fica no CLIP de propósito (por enquanto)

`ShotScaleClassifier`, `burst_service` (rajadas) e `segment.beat_embedder=clip` têm limiares
calibrados no espaço do CLIP. Continuam no clássico independentemente do motor escolhido.
Migração só na Fase 4, com recalibração.

### 1.6 Testes automáticos (rodam sem baixar o modelo)

Motor falso em `tests/embedder_falso.py` (mesmo padrão de `tests/laya_falsa.py`): vetores
determinísticos, dimensão configurável.

- `test_motores_embedding.py`
  - o motor clássico produz os mesmos vetores que o código atual
  - prefixos do Gemma 2 corretos (consulta, documento com e sem título, mídia sem prefixo)
  - vetores truncados saem com norma 1
  - fp16 é recusado com erro claro
  - coleção e dimensão certas por motor/dimensão
- `test_busca_dupla.py`
  - com indexação dupla, um mesmo item aparece nas duas coleções
  - `search.motor` muda a coleção consultada nas rotas de `media.py` e `narrative.py`
  - fallback para o clássico quando a `__eg2` está vazia ou o modelo falha
  - modo `comparar` devolve as duas listas, rotuladas
  - indexação dupla desligada não toca nas coleções `__eg2`
- Teste de fumaça opcional (marcado `@pytest.mark.modelo_real`, fora do CI): carrega o
  Gemma 2 de verdade e confere dimensão, norma e ausência de NaN.

---

## Fase 2 — Escolha na interface

- **Seletor de motor** no painel de busca (Clássico / Gemma 2 / Comparar), lembrando a escolha.
- **Modo Comparar**: duas colunas, A e B, com a mesma consulta. A ordem das colunas é sorteada
  e os nomes ficam escondidos até você votar, para evitar viés. Cada resultado tem 👍/👎.
- Os votos vão para uma tabela `busca_avaliacao` (consulta, motor, item, posição, voto) e
  alimentam o **conjunto ouro** da Fase 0 automaticamente, ou seja, o uso real vira teste.
- Um painel simples em Configurações mostra o placar acumulado (vitórias de cada motor).

---

## Fase 3 — O que só o Gemma 2 faz

- **Busca por som**: indexar o áudio dos clipes em janelas (ex.: 10 s, mono 16 kHz) para achar
  "aplausos", "trovão", "sirene" sem depender da transcrição.
- **Busca por trecho de vídeo**: embedar o segmento inteiro (1 quadro/s) em vez de só o keyframe.
- **Busca unificada**: uma consulta só, resultados de falas, imagens e sons numa lista única,
  já que estão no mesmo espaço.
- **"Mais parecidos com este momento"** cruzando mídias (um frame encontra uma fala, e vice-versa).

Cada item entra só se o modo Comparar mostrar ganho real.

---

## Fase 4 — (Opcional) Aposentar o CLIP

Recalibrar escala de plano, rajadas e beats no espaço do Gemma 2, usando o conjunto ouro e os
votos. Só depois disso o clássico pode deixar de ser carregado. Até lá ele continua disponível.

---

## Reversão

- Voltar `search.motor` para `classico` e desligar `search.indexar_gemma2`: o app volta a ser
  exatamente o de hoje.
- Remover de vez: apagar as coleções `__eg2` (o script de reindexação tem `--apagar`).

---

## Pendências para decidir

1. **Quanta RAM tem a máquina de edição?** Define se dá para carregar texto+imagem do Gemma 2
   junto com o CLIP durante a convivência.
2. **A escolha de motor é global ou por projeto?** A proposta é por projeto, para testar num
   acervo sem mexer nos outros.
3. **Indexação dupla é aceitável** no tempo de análise de lotes grandes, ou prefere só o
   backfill noturno (`reindexar_gemma2.py`)?

## O que dá para fazer agora, sem os seus arquivos

- Fase 0.1 (script) + conjunto sintético (0.2.1), com o script rodando de verdade aqui.
- Fase 1 inteira com o motor falso e os testes automáticos.
- Deixar o gerador do conjunto do acervo (0.2.2) pronto para você rodar em casa num comando.
