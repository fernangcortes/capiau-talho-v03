# Plano de Implementação — Reforma do Pipeline de Análise

> **Documento de trabalho.** Marque as tasks com `[x]` conforme concluídas.
> Relatório de arquitetura completo: https://claude.ai/code/artifact/9de4fa11-c29f-4a13-8c7f-6f410b352dcc
>
> **Modo de trabalho acordado:** uma etapa por vez, com **parada obrigatória para testes do usuário** ao final de cada uma. Nenhuma etapa começa sem o OK da anterior.

## Decisões fechadas (12/07/2026)

| Decisão | Escolha |
|---|---|
| Perfis de lançamento | Making of + Documentário (compartilham ~80% do vocabulário) |
| Taxonomia Eixo A | 9 categorias fixas: `obra`, `processo`, `depoimento`, `cotidiano`, `evento`, `tecnico`, `arquivo`, `pessoal`, `documento` |
| Política local × API | Econômica em T0 (visão/ASR na API, resto local); funções migram para local conforme o tier da máquina |
| Farm (7 ilhas A4000) | Etapa 4 — single-machine primeiro |
| Bancada de VLMs locais | Quando houver máquina T2 (16GB VRAM) disponível para teste |

## Convenções para todas as etapas

- **Nada de viés nos prompts**: nenhum prompt novo pode presumir tipo de conteúdo ("making of", "bastidores" etc.). A categoria vem sempre da triagem.
- **Tudo configurável**: cada parâmetro novo entra no `settings_registry.py` (default = comportamento do código), nunca hardcoded.
- **Migrações seguras**: sempre `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` em `schema.py` (padrão já existente). Nunca quebrar banco existente.
- **Prompts editáveis**: prompts novos entram no `PROMPT_REGISTRY` com `label`, `category` e `variables` para aparecerem no painel.
- **Custo visível**: toda análise nova que chama API deve logar contagem de chamadas para comparação antes/depois.
- **Risco de ambiente (Python 3.14)**: várias libs ainda não têm wheel para 3.14 (`opentimelineio` já falhou). **Antes de cada etapa, testar `pip install` das dependências novas**; se falhar, considerar venv com Python 3.12 para os processos locais pesados.
- **Console cp1252 (Windows)**: o terminal desta máquina não codifica `→`, `≤` nem emoji — um `print` com esses caracteres levanta `UnicodeEncodeError`. **Nunca usar caracteres fora do cp1252 em log** (acento pode; use `->` e `<=`). E **nunca colocar log dentro de um `try` amplo**: um erro de log vira degradação silenciosa do pipeline (foi o que aconteceu com o E2.A5 — ver 14/07). `tests/test_f5_console_encoding.py` guarda a regra e `make_console_crash_proof()` é a rede de segurança no boot.

---

## ETAPA 1 — Sanear a base ✅ implementada em 12/07/2026

Código pronto e verificado (servidor sobe, migração aplicada, testes passam). **Aceito pelo usuário em 12/07/2026.**

### E1.T — Checklist de teste (usuário)

- [x] **E1.T1** Reanalisar individualmente ~10 vídeos variados (1 conversa casual, 1 making of real, 1 entrevista, 1 sem relação com o filme). Conferir no card/tooltip: categoria correta? título curto e distinto? tags específicas (sem "making of"/"bastidores")?
- [x] **E1.T2** Reanalisar ~10 fotos variadas. Conferir categoria + título (agora vêm na mesma chamada de visão, sem custo extra).
- [x] **E1.T3** Fazer 3 buscas que antes retornavam resultados repetidos. O topo está mais variado? (MMR ativo; ajustar em Configurações → Temas & Busca → `search.mmr_lambda`.)
- [x] **E1.T4** Perguntar ao chat algo que antes gerava sugestões repetidas; conferir diversidade.
- [ ] **E1.T5** Se aprovado: reanálise completa (`analyze-all-vision?force=true`), reindexação de embeddings e re-clusterização de temas. **Atenção: custa API para o acervo inteiro (541 vídeos + 1.424 fotos).** ⚠️ **Não rodar antes de E2.B4 (dedupe de rajadas) e E2.C1 (perfis de esforço) estarem prontos — ambos reduzem diretamente o custo desta rodada única.**
- [ ] **E1.T6** Instalar `opentimelineio` quando houver solução para Python 3.14 (ou venv 3.12) para reativar exportação OTIO/XML/EDL.

---

## ETAPA 2 — Segmentação, CLIP local e análise condicional

**Objetivo:** substituir o relógio de 10s por segmentação real (shots + beats), ganhar busca por imagem sem custo de API, e gastar análise cara só onde a categoria justifica.
**Esforço estimado:** 2–3 semanas. **Custo de API esperado: cai** (menos frames, análise leve para categorias baratas).

### E2.A — Segmentação (shots + beats)

- [x] **E2.A1 — Dependência e módulo base**
  Instalar `scenedetect[opencv]` (puro Python + OpenCV, sem risco de wheel). Criar `src/vision/segmentation.py` com `detect_shots(video_path) -> [{start, end}]` usando ContentDetector + AdaptiveDetector **sobre o proxy 720p** (velocidade).
  *Aceite:* vídeo editado retorna shots nos cortes; vídeo bruto de plano-sequência retorna 1 shot único (comportamento correto).

- [x] **E2.A2 — Tabela `media_segment`**
  Migração em `schema.py`: `media_segment(id, project_id, video_id, kind CHECK('shot','beat'), start_time, end_time, reason TEXT, motion_label TEXT, created_at)` + índices por vídeo.
  *Aceite:* migração roda em banco existente sem erro.

- [x] **E2.A3 — Beats por deriva de embedding**
  Em `segmentation.py`: amostrar 1 frame a cada 1–2s dentro de cada shot longo (> `segment.min_beat_shot_s`, default 20s), embeddar (CLIP do E2.B; fallback: histograma HSV), abrir beat novo quando distância cosseno ao centróide corrente > `segment.beat_drift_threshold` (default a calibrar ~0.35). Gravar `reason` ("mudança de ambiente/conteúdo").
  *Aceite:* plano-sequência de câmera na mão do acervo real é dividido em beats que fazem sentido visual (validar com o usuário em 3–5 arquivos).

- [x] **E2.A4 — Movimento de câmera (optical flow)**
  Em `segmentation.py`: fluxo óptico global entre frames subamostrados (Farneback ou goodFeaturesToTrack + estimateAffinePartial2D) → classificar `static | pan | tilt | walk | handheld | whip`. Transição de estado = candidata a fronteira de beat; rótulo vai em `motion_label`.
  *Aceite:* teste com 3 clipes conhecidos (1 parado, 1 pan, 1 caminhando) classifica certo.

- [x] **E2.A5 — Integrar na visão**
  Em `analyze_video_vision`: quando `vision.use_segments = true` (novo setting, default true), extrair **1 keyframe por shot/beat (ponto médio)** em vez de frame a cada 10s. Manter `vision.frame_interval` como teto (nunca mais frames que duração/intervalo).
  *Aceite:* contagem de chamadas de visão por vídeo cai vs. baseline de 10s; log mostra "N segmentos → N chamadas".
  ⚠️ **(14/07) Estava quebrado desde a implementação e ninguém viu.** O próprio log de sucesso continha `→`/`≤`, que o console cp1252 não codifica: o `UnicodeEncodeError` era engolido pelo `except` do bloco, que zerava `frame_jobs` e **rebaixava toda análise para o relógio fixo de 10s**, imprimindo "Falha na segmentação, usando relógio fixo". Como os segmentos são gravados no banco *antes* do log, `media_segment` ficava correto e a validação de beats (E2.A3) passava — mas a visão nunca usou os keyframes. **Nenhuma economia de API foi obtida até aqui.** Corrigido: log em ASCII e movido para fora do `try` (log não pode alterar o pipeline) + rede de segurança no boot. Verificado ponta a ponta: `2 segmentos -> 2 keyframes` no vídeo-fixture, com a API mockada.

- [x] **E2.A6 — Fronteiras reais no Qdrant**
  Payload dos frames indexados usa `start_time/end_time` do segmento (não `timestamp + FRAME_INTERVAL`). O player já pula para o trecho — a janela fica precisa.
  *Aceite:* clicar num resultado de busca abre o trecho exato do beat.

### E2.B — Embeddings de imagem (CLIP local)

- [x] **E2.B1 — Motor de embeddings de imagem**
  Criar `src/search/image_semantic.py` (singleton `ImageSearch`): modelo de imagem `clip-ViT-B-32` + texto multilíngue `sentence-transformers/clip-ViT-B-32-multilingual-v1` (mesma lib já usada — sem dependência nova além dos pesos). Coleção Qdrant separada `capiau_images` (512d, cosine). Testar `pip`/download dos pesos ANTES de codar o resto.
  *Aceite:* embedar 100 imagens em CPU em tempo aceitável (< ~2 min); busca "pessoa de boné vermelho" retorna imagem certa num teste controlado.

- [x] **E2.B2 — Indexação**
  Indexar 1 vetor por keyframe de vídeo (por segmento, usando o frame já extraído na visão — sem custo extra de FFmpeg) e 1 por foto (proxy WebP). Payload: `project_id, video_id/photo_id, start_time, end_time, segment_id`.
  *Aceite:* após analisar 1 vídeo e 5 fotos, coleção contém os pontos com payload correto.

- [x] **E2.B3 — Busca visual integrada**
  Novo endpoint `GET /api/search/visual?q=&project_id=` + integração no `search_hybrid`: resultados de imagem entram na fusão com peso `search.image_weight` (default 0.5). MMR continua por cima.
  *Aceite:* busca por conceito visual sem palavra correspondente nas descrições ("contraluz na janela") encontra material.

- [x] **E2.B4 — Dedupe e rajadas de fotos**
  Agrupar fotos com similaridade CLIP > 0.97: coluna `burst_group_id` em `photo` (migração). Análise de visão roda **1x por grupo** e replica descrição/categoria/título para o grupo (com sufixo de variação).
  *Aceite:* rajada de 20 fotos = 1 chamada de API; biblioteca continua mostrando todas.
  *(14/07: `src/services/burst_service.py` substitui a heurística antiga de mtime (<5s na mesma pasta) do `analyze-all-vision`. Encadeia por pasta+tempo e decide por cosseno CLIP contra a **líder** do grupo — não contra a foto anterior — para a deriva lenta não arrastar o grupo. Membros herdam descrição/tags/categoria/título/`raw_description` com sufixo "Quadro N de M da mesma sequência" e são indexados no Qdrant reaproveitando o embedding do agrupamento. Reanálise individual de um membro zera seu `burst_group_id`. Settings: `burst.enabled` (simples), `burst.similarity_threshold`/`time_window_s`/`max_group_size` (pro) + limiar nos presets econômico (0.95) e máxima qualidade (0.985). 8 testes novos em `tests/test_f4_bursts.py` com CLIP real; migração validada no banco real (1.424 fotos, idempotente).)*

- [ ] **E2.B5 — Zero-shot tagging de entidades**
  Para cada keyframe/foto: similaridade CLIP contra nomes+aliases de entidades `object|location` do projeto; acima de `clip.entity_threshold` (default 0.28, calibrar) → `entity_mention(source='clip_auto', status='auto')`.
  *Aceite:* objeto cadastrado (ex: um prop do filme) é encontrado em fotos onde a visão textual não o citou. Sem falsos positivos gritantes no limiar default.

- [x] **E2.B6 — "Encontrar similares"**
  Endpoint `GET /api/media/{video|photo}/{id}/similar` + botão no card/inspetor.
  *Aceite:* clicar numa foto retorna as visualmente próximas.
  *(13/07: UI concluída — botão no card de foto, no lightbox e na aba IA do inspetor de vídeo; resultados enriquecidos no backend e `segment_id` real no payload CLIP dos keyframes.)*

### E2.C — Análise condicional por categoria

- [ ] **E2.C1 — Perfis de esforço**
  Mapa categoria → esforço em `src/services/analysis_policy.py`: `obra|processo|depoimento|evento` = completo; `tecnico|arquivo` = keyframes reduzidos (1 por shot, sem beats); `cotidiano|pessoal` = só triagem + 2 keyframes + sumário curto. Configurável por setting `analysis.effort_overrides` (JSON).
  *Aceite:* vídeo classificado `cotidiano` consome ≤ 3 chamadas de visão no total.

- [ ] **E2.C2 — Fila de revisão de triagem**
  Endpoint `GET /api/project/{id}/triage/review` (mídias com `category_confidence < triage.min_confidence` ou categoria `outro`) + `PATCH /api/{video|photo}/{id}/category`. UI: filtro "Revisar triagem" na biblioteca + dropdown de categoria no inspetor.
  *Aceite:* corrigir categoria pela UI persiste e re-deriva `video_type` quando aplicável.

- [ ] **E2.C3 — Correções viram few-shot**
  Tabela `triage_feedback(project_id, media_kind, media_id, wrong_category, right_category, note, created_at)`. As últimas ~6 correções entram no prompt `triage` como exemplos ("neste projeto, X foi classificado como Y porque...").
  *Aceite:* após 3 correções do mesmo tipo de erro, novas triagens do mesmo padrão acertam (validar com material real).

### E2.D — Gramática do Plano (mínimo viável)

- [ ] **E2.D1 — Escala de plano** — zero-shot CLIP por keyframe contra rótulos fechados (`close-up`, `plano médio`, `plano americano`, `plano geral`, `detalhe`, `aéreo/drone`) → faceta `shot_scale` no payload Qdrant + coluna em `media_segment`.
  *Aceite:* precisão razoável num teste manual com 20 frames variados (≥ ~75%).
- [ ] **E2.D2 — Paleta e temperatura** — k-means de cor dominante + classificação quente/neutro/frio por keyframe (OpenCV puro) → facetas `palette_temp`, `palette_hex`.
  *Aceite:* busca filtrada por "tons quentes" retorna entardeceres/interiores de tungstênio.
- [ ] **E2.D3 — Facetas na busca** — query params `shot_scale`, `palette_temp`, `camera_motion`, `category` no search + chips de filtro na UI de busca.
  *Aceite:* "closes" + categoria "depoimento" filtra corretamente.

### E2.E — Parada de teste (usuário)

- [ ] Validar beats em 5 planos-sequência reais; comparar custo de visão antes/depois; testar busca visual e filtros de faceta; aprovar ou ajustar limiares.
- [ ] **Revalidar E2.A5/E2.A6 com material real.** O bug de log (ver E2.A5) mascarou a segmentação na visão até 14/07: qualquer medição de custo ou janela de busca feita antes disso não vale. Reanalisar alguns vídeos e conferir no console o log `N segmentos -> N keyframes` (se aparecer "Falha na segmentação, usando relógio fixo", avisar).

---

## ETAPA 3 — Sala de Projeto + Capability Manager

**Objetivo:** contexto do projeto nasce de conversa/documentos e alimenta todas as análises; o programa conhece a máquina e escolhe/instala modelos.
**Esforço estimado:** 3–4 semanas.

### E3.A — Cartão de Contexto e perfis

- [ ] **E3.A1 — Schema** — Tabela `project_context(project_id, version, context_json, compiled_text, created_at)`; coluna `profile` em `project` (migração).
- [ ] **E3.A2 — Perfis** — `src/services/profiles.py` com templates `making_of` e `documentario`: vocabulário Eixo B, análises ativas, pesos de busca, personas default. Estrutura JSON documentada para perfis futuros (ficção, publicidade, jornalismo, evento, conteúdo digital, acervo).
- [ ] **E3.A3 — Compilador do Cartão** — Função que compila brief + entidades-chave + vocabulário + correções em `compiled_text` com **teto de ~2.000 tokens** (truncamento inteligente por prioridade). Nova variável `{project_context_block}` injetada nos prompts `triage`, `vision`, `interview_summary`, `broll_summary`, `chatbot_system`.
  *Aceite:* mesmo material analisado com/sem cartão mostra diferença visível na especificidade (nomes certos, foco no que importa).

### E3.B — Chat produtor (onboarding)

- [ ] **E3.B1 — Prompt e ferramenta** — Prompt `producer_interview` no registry (entrevista: objetivo, entregas, pessoas-chave, buscas esperadas, sensibilidades) com function-calling `update_brief(field, value)` reaproveitando o loop do `chat_agent.py`.
- [ ] **E3.B2 — Endpoint** — `POST /api/project/{id}/onboarding/chat` (mensagem → resposta + brief atualizado).
- [ ] **E3.B3 — UI Sala de Projeto** — Tela/modal ao criar projeto com as 5 estações (perfil em cards, chat + brief editável lado a lado, upload de documentos, análise piloto, revisão do Cartão). Todas as estações puláveis; aviso do que se perde ao pular. **Modo direto**: perfil + defaults em 2 cliques.
  *Aceite:* projeto novo criado pelas duas vias (guiada e direta) fica funcional.

### E3.C — Extração de documentos estruturantes

- [ ] **E3.C1 — Extração de roteiro** — Prompt `script_extract` (chunking p/ roteiros longos): personagens (nome+descrição), cenas (número, sinopse, personagens, props, locação), objetos-chave. Suporte a PDF/DOCX/TXT/Fountain (o upload de docs já existe).
- [ ] **E3.C2 — Schema** — Tabela `scene(project_id, number, synopsis, characters_json, props_json, location, created_at)`; coluna `status ('suggested','confirmed','rejected')` em `entity` (migração); vínculo `entity ↔ scene` via JSON ou tabela `scene_entity`.
- [ ] **E3.C3 — UI de curadoria** — Lista de sugestões extraídas com aceitar/rejeitar/editar em massa. Só entidades `confirmed` entram nos prompts de visão.
- [ ] **E3.C4 — Ficha técnica → galeria facial** — Extração de pessoas+funções; upload de foto de referência por pessoa → embedding facial seed → matching prioritário contra seeds ANTES do DBSCAN (clusters nascem nomeados).
  *Aceite:* após cadastrar 5 seeds, rodada de clustering nomeia automaticamente os grupos correspondentes.

### E3.D — Análise piloto

- [ ] **E3.D1 — Amostragem** — Amostra estratificada por pasta/tipo/data (`pilot.sample_size`, default 30).
- [ ] **E3.D2 — Mural de correção** — Roda triagem na amostra; grade com categoria/título por item e correção por clique (reusa E2.C2/C3 — correções viram few-shot).
- [ ] **E3.D3 — Estimativas honestas** — Projeção de custo de API para o acervo inteiro (nº de chamadas × tabela de preços configurável) e tempo local × nuvem (benchmark do Capability Manager). Exibidas antes do usuário disparar a análise completa.
  *Aceite:* estimativa bate com ±30% do custo real medido na amostra.

### E3.E — Capability Manager

- [ ] **E3.E1 — Sondagem** — `src/services/capability.py`: CPU/núcleos, RAM, GPU+VRAM (`nvidia-smi`/torch), disco, SO; micro-benchmark opcional (embedar 100 imagens, encodar 30s). Classificação T0–T3 persistida em `app_setting`.
- [ ] **E3.E2 — Registro de modelos** — `data/model_registry.json` versionado: por função (ASR, visão-triagem, visão-descrição, embed-texto, embed-imagem, faces, reranker, LLM-texto) → lista ordenada de implementações com tier mínimo, tamanho de download, e fallback API.
- [ ] **E3.E3 — Resolução por função** — Pipeline pede `resolve("asr")` e recebe a implementação; refatorar chamadas diretas (AssemblyAI, OpenRouter vision) para passar pelo resolver. Política por projeto: `privacy_local_only`, `api_budget`.
- [ ] **E3.E4 — Instalação assistida** — Endpoint que instala pacote/baixa pesos **com consentimento explícito** (mostra tamanho/ganho), roda teste de sanidade e registra versão. ⚠️ Testar disponibilidade de wheels no Python da máquina antes de oferecer (lição do opentimelineio).
- [ ] **E3.E5 — Integrações T1/T2 concretas** — `faster-whisper` como ASR local (ctranslate2 — VERIFICAR wheel p/ 3.14; senão venv 3.12 dedicado); InsightFace como backend facial default quando disponível (Tier 3 da cascata `face_pipeline.py` já existe — falta só promovê-lo no fluxo principal).
- [ ] **E3.E6 — UI "Máquina & Modelos"** — Painel mostrando tier detectado, o que roda local × API, botões de instalação, política do projeto.
  *Aceite:* na máquina atual (T0) tudo continua como está; numa máquina com GPU o painel oferece os upgrades corretos.

### E3.F — Parada de teste (usuário)

- [ ] Criar um projeto novo do zero pela Sala de Projeto (via guiada); importar o roteiro real do filme; validar entidades/cenas extraídas; rodar piloto e conferir estimativas; validar que o Cartão de Contexto melhora as análises.

---

## ETAPA 4 — Busca multi-vetor, chat agêntico, MCP e farm

**Objetivo:** fechar o ciclo busca → edição assistida → automação externa.
**Esforço estimado:** 2–3 semanas.

### E4.A — Busca em 3 passos

- [ ] **E4.A1 — Query parser** — LLM barato extrai da query: filtros (pessoa, categoria, cena, facetas, período) + intenção + query semântica limpa. Fallback regex (nomes conhecidos) quando sem API. Setting `search.parse_query` (bool).
- [ ] **E4.A2 — Fusão texto+imagem** — Reciprocal Rank Fusion dos rankings das duas coleções + filtros de payload + MMR (já existe).
  *Aceite:* "fotos do João na cozinha" filtra por rosto=João + busca semântica/visual do local.

### E4.B — Chat com ferramentas de busca

- [ ] **E4.B1** — Substituir a injeção RAG única do chatbot por tools: `search_media(query, filters, page)`, `get_media_details(id)` — reaproveitando o loop de function-calling do `chat_agent.py`. O modelo decide refinar/variar buscas.
  *Aceite:* pedir "outras opções" ao chat retorna material diferente, não os mesmos 5 resultados.

### E4.C — Servidor MCP

- [ ] **E4.C1** — `src/mcp/server.py` com FastMCP expondo as tools existentes do agente (search_media, get_transcript, get_timeline_state, insert_clip, propose_bulk_edit...). Transporte stdio + HTTP local; documentar registro no Claude Code/Desktop.
  *Aceite:* de uma sessão Claude Code externa, buscar mídia e inserir um clipe na timeline do CapIAu.

### E4.D — Farm (7 ilhas A4000)

- [ ] **E4.D1 — Fila persistente** — Migrar TASK_MANAGER para fila em SQLite (`job(id, type, payload, status, worker, started_at, finished_at)`) com retry e prioridade.
- [ ] **E4.D2 — Worker remoto** — Modo `python -m src.worker --server http://central:8000`: puxa jobs, processa local (storage compartilhado com os mesmos caminhos), devolve resultado. Autenticação por token simples na LAN.
- [ ] **E4.D3 — Painel de fila** — Aba Tarefas mostra workers ativos e throughput.
  *Aceite:* 2 máquinas processando o mesmo projeto em paralelo sem conflito de banco (WAL + writes só pelo central, workers devolvem via API).

### E4.E — Parada de teste (usuário)

- [ ] Busca composta com filtros; chat variando sugestões; MCP de fora; farm com 2+ ilhas.

---

## Dependências novas por etapa (verificar wheels no Python 3.14 ANTES de codar)

| Etapa | Pacote | Risco 3.14 | Plano B |
|---|---|---|---|
| E2 | `scenedetect[opencv]` | baixo (puro Python) | — |
| E2 | pesos CLIP (`clip-ViT-B-32` + multilingual) | baixo (sentence-transformers já instalado) | — |
| E3 | `psutil` | baixo | — |
| E3 | `faster-whisper` (ctranslate2) | **médio/alto** | venv Python 3.12 dedicado como worker local |
| E3 | `insightface` + `onnxruntime` | médio | manter SFace (Tier 0) até wheel sair |
| E4 | `fastmcp` | baixo | SDK MCP oficial |
| pendente | `opentimelineio` | **alto (já falhou)** | venv 3.12 só para exportação, ou aguardar wheel |
