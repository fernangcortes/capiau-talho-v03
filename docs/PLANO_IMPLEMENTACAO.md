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
- [x] **E1.T5** Se aprovado: reanálise completa (`analyze-all-vision?force=true`), reindexação de embeddings e re-clusterização de temas. **Atenção: custa API para o acervo inteiro (541 vídeos + 1.424 fotos).** ⚠️ **Não rodar antes de E2.B4 (dedupe de rajadas) e E2.C1 (perfis de esforço) estarem prontos — ambos reduzem diretamente o custo desta rodada única.**
  ✅ **(19/07) Concluído.** Rodou pelo `worker_vision` entre 14 e 17/07 (backups `pre_e1t5_*`, `pre_worker_*`, `pre_restart2_*`, `pre_retriage_*` contam a linha do tempo). Estado final verificado no banco em 19/07: **532/541 vídeos com categoria** (os 9 sem categoria são as entrevistas — correto, seguem via transcrição), **534 vídeos com descrição**, **1.424/1.424 fotos com categoria e descrição**, **196 rajadas agrupando 456 fotos = 260 chamadas economizadas** (exatamente os −18% projetados para limiar 0.93). Confiança de triagem alta no geral: 0 vídeos e só 6 fotos abaixo de 0.7.
  **O que a rodada ensinou (corrigido em produção durante a execução, commits de 17/07):**
  - **402 fantasma:** sem `max_tokens` declarado, a OpenRouter reservava o teto de saída do modelo inteiro por chamada e recusava com "sem crédito" havendo saldo — 66 triagens falharam assim. Corrigido declarando `max_tokens` (novo setting).
  - **Retry + fallback automático de modelo** na visão e no enrichment; falha de API não sobrescreve mais descrição boa existente.
  - **Nemotron gratuito medido em produção e descartado** — Gemini voltou como padrão; a escolha do modelo de visão virou dropdown em Configurações.
  - **Mix real do acervo confirmou a amostra:** vídeos = 56% `processo` + 21% `obra`; fotos = 68% `cotidiano` (967/1.424) — número alto que merece revisão humana (motivação direta para o E2.C2).
  ✅ **(14/07) Corrigido: caminhos das 1.424 fotos estavam obsoletos no banco.** Apontavam para `D:\makinof-monstro\Fotos\` (o `D:` atual é o disco de sistema, sem essa pasta); os arquivos reais estão em `F:\Making Off - O Monstro\Fotos O MONSTRO\`. Conferido 1.424/1.424 por nome (zero duplicatas, `filename` = basename), backup do banco tirado antes (`data/capiau.db.pre_fix_paths_*.bak`), `UPDATE` aplicado, verificado 0 caminhos quebrados após. Efeito: o CLIP e a análise de foto já funcionavam antes (usam o proxy WebP local), mas o **`mtime` estava zerado para as 1.424** → a trava `burst.time_window_s` (30s) do dedupe de rajadas rodava inerte, sem a proteção contra falso agrupamento. Com os caminhos corrigidos os mtimes agora são reais e a trava está ativa — remedição abaixo.
- [x] **E1.T6** Instalar `opentimelineio` quando houver solução para Python 3.14 (ou venv 3.12) para reativar exportação OTIO/XML/EDL.
  ✅ **(20/07) Resolvido pelo plano B — venv 3.12 dedicado + ponte por subprocesso.** O 0.18.1 continua sem wheel cp314 (verificado com `pip download --only-binary`); criado `data/venv312` via `uv` (CPython 3.12.12 standalone, sem tocar no Python do sistema) com `opentimelineio` + `otio-fcp-adapter` + `otio-cmx3600-adapter` (no 0.16+ os adaptadores XML/EDL saíram do core) + `python-dotenv`. `otio_export.py` agora delega por subprocesso quando o import falha (`_export_via_worker` → `python -m src.export.otio_export` no venv; caminho configurável em `export.worker_python`, default auto-detectado). Worker herda `DB_PATH`/`EXPORTS_DIR` por env var (testes usam banco temporário). **Validado ponta a ponta em 20/07: timeline real "teste jlcut" exportada nos 3 formatos pela API (HTTP 200), EDL com timecodes corretos.** 4 testes novos em `tests/test_f0b_export_bridge.py` (rodam no 3.14 sem otio; pulam se o venv não existir). ⚠️ O `tests/test_f0_otio_export.py` antigo importa `otio` no topo e não carrega no 3.14 — segue válido apenas dentro do venv.
  ⚠️ **(20/07) Descoberto na validação: o `--reload` do uvicorn NÃO recarrega código nesta máquina.** Causa raiz capturada no log mais tarde na mesma madrugada: ao detectar mudança de arquivo, o reloader chama `os.kill(pid, CTRL_C_EVENT)` — sinal que **não existe para processo sem console** (o launcher desgrudado) → `OSError WinError 6` e **o servidor MORRE em vez de recarregar** (e no processo preso ao console, o reload também nunca funcionou). **Regra desta máquina: rodar SEM `--reload`; toda mudança de backend = reiniciar de verdade** (`scripts/launch_detached.py C:/Python314/python.exe -m uvicorn src.api.server:app --stdout ... --stderr ...`). Havia ainda uma 2ª instância esquecida na :8001 disputando o lock do Qdrant (a causa clássica dos 500 de busca); ambas foram derrubadas e o servidor voltou como instância única desgrudada do console, com busca verificada saudável após o restart.
  **(20/07, madrugada) Dois defeitos reportados no teste do usuário, corrigidos e provados ponta a ponta:**
  - **"Busca do cabeçalho não mostra nada":** ✅ **causa principal identificada pelo usuário em 20/07 — ele estava na PORTA 8001** (instância zumbi SEM o lock do Qdrant): as buscas falhavam **em silêncio**, devolvendo vazio sem nenhum aviso. Na 8000 tudo funciona. A instância 8001 foi derrubada (2x — ela reapareceu e foi morta de novo). Dois endurecimentos ficaram do diagnóstico: (a) a busca agora **revela o painel direito** se estiver recolhido (`window.expandRightPanel` em `runSemanticSearch`/`showSimilarMedia` — o inspetor invisível de 19/07 tinha deixado o painel recolhido); (b) **o silêncio do Qdrant virou o item P0 da próxima sessão** — falha de índice tem que aparecer como aviso na UI, nunca como resultado vazio.
  - **"Upload de roteiro falha (pypdf)":** dois defeitos empilhados — (1) `pypdf` não estava instalado (instalado 6.14.2; o aviso de TXT com a mesma mensagem era o seletor de arquivo reenviando o mesmo .pdf — o caminho .txt nunca usa pypdf); (2) por baixo, `projects.py` usava `SemanticSearch` **sem importar** — o upload quebraria de qualquer jeito na indexação (e o commit acontece antes: as falhas deixavam docs órfãos no banco, já limpos). Import corrigido; upload de .txt e .pdf validados com arquivos reais no servidor no ar e removidos em seguida.

---

## ETAPA 2 — Segmentação, CLIP local e análise condicional

**Objetivo:** substituir o relógio de 10s por segmentação real (shots + beats), ganhar busca por imagem sem custo de API, e gastar análise cara só onde a categoria justifica.
**Esforço estimado:** 2–3 semanas. ~~**Custo de API esperado: cai** (menos frames, análise leve para categorias baratas).~~
**Corrigido em 14/07 com medição real (ver E2.E):** a segmentação **não** produz menos frames — produz **+13%** (o piso de cobertura garante `keyframes >= baseline`); as rajadas economizam **−6%** neste acervo, não uma ordem de grandeza. **A queda de custo vem essencialmente do E2.C1 (análise leve por categoria)**; sem ele a Etapa 2 sai **mais cara** que a Etapa 1. O que a segmentação entrega de fato é **precisão de janela** (E2.A6) e a base para as facetas (E2.D).

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
  ⚠️ **(14/07) O aceite de custo não é atendido e não é atingível como o código está.** Medido em material real: **+13% de keyframes**, não menos (ver tabela no E2.E). O piso de cobertura do `_plan_keyframes` garante `keyframes >= baseline` por construção. O log "N segmentos -> N keyframes" funciona; o que era falso era a premissa de economia. **O valor entregue por este item é o do E2.A6 (janela precisa), não custo.**
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
  ⚠️ **(14/07, no E2.E) Estava quebrado em produção: `group_photo_bursts` levantava `TypeError` na primeira linha útil.** O código chamava `S.get("burst.similarity_threshold", 0.97)`, mas `ResolvedSettings.get()` aceita **1 argumento** — o default vem do `settings_registry`. Os 8 testes passavam porque o dublê de configuração era um **dict** (`dict.get(k, default)` aceita o default) em vez do tipo real. Como a chamada está fora de `try` no `analyze-all-vision`, o E1.T5 teria analisado os 529 vídeos e **quebrado inteiro na fase das fotos, sem agrupar nada**. Corrigido (sem default na chamada) e os testes agora usam `ResolvedSettings` de verdade — mesma classe de bug do E2.A5: o caminho real nunca era exercitado.
  ⚠️ **Economia real medida no acervo (14/07): −6%, não a ordem de grandeza do aceite.** Dry-run nas 1.424 fotos reais (CLIP local, 7,2 min): **1.424 → 1.343 chamadas (81 economizadas, 72 rajadas, maior grupo = 4 fotos)**. O aceite "rajada de 20 fotos = 1 chamada" é propriedade da fixture sintética, não deste acervo. Além disso os originais estão em `D:\makinof-monstro\Fotos` (drive **offline**): sem `mtime` legível, **`burst.time_window_s` não filtra nada** e o agrupamento fica só por pasta + CLIP (e as 1.424 fotos estão todas na mesma pasta). Os proxies WebP locais existem (1.424/1.424), então o CLIP roda. Com o drive conectado a janela volta a valer e a economia **só pode diminuir** — os −6% são teto. Um aviso no log passou a sinalizar essa degradação em vez de deixá-la silenciosa.
  **Sweep do limiar no acervo real (14/07)** — vetores CLIP das 1.424 fotos, mesma regra de encadeamento:

  | limiar | chamadas | economia | rajadas | maior grupo |
  |---|---|---|---|---|
  | 0.99 | 1.407 | −1% | 16 | 3 |
  | 0.985 (preset máx. qualidade) | 1.394 | −2% | 29 | 3 |
  | **0.97 (default atual)** | **1.343** | **−6%** | 72 | 4 |
  | 0.95 (preset econômico) | 1.262 | −11% | 133 | 5 |
  | **0.93** | **1.159** | **−19%** | 195 | 8 |
  | 0.90 | 1.009 | −29% | 268 | 10 |
  | 0.85 | 805 | −43% | 354 | 11 |

  **Inspeção visual (14/07): 3 grupos a 0.97 + os 30 maiores a 0.93**, em contact sheets gerados dos proxies (1 linha = 1 grupo, com o cosseno de cada foto contra a líder).
  - **0.97 — 3/3 legítimos**, quadros praticamente idênticos (limiar conservador).
  - **0.93 — 30/30 legítimos.** Nenhum falso agrupamento: mesma vista de janela com só o trânsito mudando, mesma pessoa à noite no mesmo caminho, mesmo carro no set, mesma bancada de maquiagem, mesmo pôr do sol. Nomes consecutivos (`IMG_3452`–`3459`) confirmam disparo contínuo.
  - Deriva observada dentro de grupos legítimos: pessoas entram/saem de quadro (ex.: `IMG_3373`, alguém entra no 3º frame). A descrição herdada da líder não menciona quem chegou depois — aceitável para rajada, mas é o limite do método.

  **Remedição (14/07) com a janela de tempo já ativa** (caminhos corrigidos, mtimes reais):

  | limiar | chamadas | economia | rajadas | maior grupo |
  |---|---|---|---|---|
  | 0.97 | 1.343 | −6% (81) | 72 | 4 (igual a antes) |
  | **0.93** | **1.164** | **−18% (260)** | 196 | **5–6** (era 8 sem a trava) |

  A economia mudou pouco (265→260 fotos a 0.93): rajadas reais já acontecem em poucos segundos, então a janela de 30s raramente precisa cortar. O que ela fez foi exatamente o esperado: **podar os grupos mais longos/arriscados sem derrubar a economia** — o grupo de 8 fotos (`IMG_3452`–`3459`, inspecionado antes) se estende por 56s e a janela agora o divide ao redor da 6ª foto, mantendo a liderança sempre a ≤30s do quadro que ela representa.

  **Decisão: `burst.similarity_threshold` = 0.93.** Confirmado com a trava de tempo ativa; os 30 grupos inspecionados visualmente continuam válidos (a maioria não chegava a durar 30s).
  *(14/07: `src/services/burst_service.py` substitui a heurística antiga de mtime (<5s na mesma pasta) do `analyze-all-vision`. Encadeia por pasta+tempo e decide por cosseno CLIP contra a **líder** do grupo — não contra a foto anterior — para a deriva lenta não arrastar o grupo. Membros herdam descrição/tags/categoria/título/`raw_description` com sufixo "Quadro N de M da mesma sequência" e são indexados no Qdrant reaproveitando o embedding do agrupamento. Reanálise individual de um membro zera seu `burst_group_id`. Settings: `burst.enabled` (simples), `burst.similarity_threshold`/`time_window_s`/`max_group_size` (pro) + limiar nos presets econômico (0.95) e máxima qualidade (0.985). 8 testes novos em `tests/test_f4_bursts.py` com CLIP real; migração validada no banco real (1.424 fotos, idempotente).)*

- [ ] **E2.B5 — Zero-shot tagging de entidades**
  Para cada keyframe/foto: similaridade CLIP contra nomes+aliases de entidades `object|location` do projeto; acima de `clip.entity_threshold` (default 0.28, calibrar) → `entity_mention(source='clip_auto', status='auto')`.
  *Aceite:* objeto cadastrado (ex: um prop do filme) é encontrado em fotos onde a visão textual não o citou. Sem falsos positivos gritantes no limiar default.
  ⚠️ **(19/07) Adiado por falta de matéria-prima:** o banco tem hoje **1 entidade `object` e nenhuma `location`** (as 44 restantes são pessoas, que já têm o caminho facial). Zero-shot contra 1 nome não valida limiar nem aceite. Faz sentido implementar junto/depois do **E3.C (extração de roteiro → entidades e props)**, que povoa o catálogo de uma vez.

- [x] **E2.B6 — "Encontrar similares"**
  Endpoint `GET /api/media/{video|photo}/{id}/similar` + botão no card/inspetor.
  *Aceite:* clicar numa foto retorna as visualmente próximas.
  *(13/07: UI concluída — botão no card de foto, no lightbox e na aba IA do inspetor de vídeo; resultados enriquecidos no backend e `segment_id` real no payload CLIP dos keyframes.)*

### E2.C — Análise condicional por categoria

- [x] **E2.C1 — Perfis de esforço**
  Mapa categoria → esforço em `src/services/analysis_policy.py`: `obra|processo|depoimento|evento` = completo; `tecnico|arquivo` = keyframes reduzidos (1 por shot, sem beats); `cotidiano|pessoal` = só triagem + 2 keyframes + sumário curto. Configurável por setting `analysis.effort_overrides` (JSON).
  *Aceite:* vídeo classificado `cotidiano` consome ≤ 3 chamadas de visão no total.
  *(14/07: implementado. `documento` — que o plano não citava — entrou como `reduzido` (página filmada é conteúdo estático). Categoria ausente/desconhecida = `completo`: nunca economizar às cegas. O perfil controla 3 coisas: `detect_beats_enabled` no `segment_video`, `coverage_floor` no `_plan_keyframes` (o piso que fatia segmento longo em keyframes de ~`frame_interval`) e o teto `max_keyframes`. O aceite fecha assim: 1 chamada de triagem + 2 keyframes = 3. **O teto vale também no fallback do relógio fixo** — sem isso uma falha de segmentação devolveria o vídeo barato ao custo cheio em silêncio (a mesma classe de bug do E2.A5). O "sumário curto" sai de graça: com 2 keyframes o `broll_summary` já recebe 2 descrições. JSON inválido é **rejeitado na escrita** (`validate_value`), não ignorado na análise. 17 testes em `tests/test_f6_effort_profiles.py`, incluindo paridade do perfil completo com o comportamento anterior.)*

- [x] **E2.C2 — Fila de revisão de triagem** ✅ implementado em 19/07 — **aguarda teste do usuário (E2.E2 abaixo)**
  Endpoint `GET /api/project/{id}/triage/review` (mídias com `category_confidence < triage.min_confidence` ou categoria `outro`) + `PATCH /api/{video|photo}/{id}/category`. UI: filtro "Revisar triagem" na biblioteca + dropdown de categoria no inspetor.
  *Aceite:* corrigir categoria pela UI persiste e re-deriva `video_type` quando aplicável. ✅ coberto por 9 testes de API (`tests/test_f7_triage_review.py`); falta só a passada de UI pelo usuário.
  **Decisões de implementação (19/07):** correção manual grava `category_confidence = 1.0` (fonte humana); corrigir foto de rajada propaga para o grupo inteiro (`burst_group_id` — os quadros são a mesma cena por construção); a tabela `triage_feedback` do E2.C3 **nasce já no C2** para nenhuma correção se perder antes do few-shot existir (o C3 só liga o consumo no prompt); entrevistas sem categoria não entram na fila (não passam por triagem de visão). Não existe categoria `outro` na taxonomia — o critério real da fila é `categoria NULL em mídia analisada` ou `confiança < triage.min_confidence`. Confirmar a mesma categoria (sem mudança) não gera feedback — confirmação não é correção — mas sobe a confiança para 1.0.
  **Onde fica na UI:** dropdown "Categoria (Triagem IA)" na aba Índice do inspetor de vídeo; dropdown "Categoria" no lightbox de foto; filtro `revisar:triagem` na busca da biblioteca (com chip de sugestão "Revisar triagem" quando houver itens). O limiar vem de `triage.min_confidence` via `/api/settings`.
  **Fila real medida (19/07, limiar 0.55): 0 vídeos + 3 fotos** — a triagem do E1.T5 saiu confiante (média 0,90); subir o limiar para 0.75 mostraria 3 vídeos + 22 fotos. O instrumento principal na prática é o dropdown (corrigir qualquer item ao navegar), e cada correção já alimenta o futuro few-shot. ⚠️ Os 68% de fotos `cotidiano` **não** aparecem na fila (confiança alta) — se a categoria estiver sistematicamente errada, é o few-shot do E2.C3 que corrige o padrão, a partir das correções feitas por aqui.

- [x] **E2.C3 — Correções viram few-shot** ✅ implementado em 20/07
  Tabela `triage_feedback(project_id, media_kind, media_id, wrong_category, right_category, note, created_at)`. As últimas ~6 correções entram no prompt `triage` como exemplos ("neste projeto, X foi classificado como Y porque...").
  *Aceite:* após 3 correções do mesmo tipo de erro, novas triagens do mesmo padrão acertam (validar com material real — **pendente de acumular correções reais**; o mecanismo está armado e testado).
  *(20/07: `_triage_feedback_block()` em `prompt_templates.py` injeta as últimas N correções (setting `triage.feedback_examples`, default 6, 0 desliga) **nos dois caminhos**: prompt `triage` de vídeo e sufixo de triagem do prompt de foto. Entra pelo `context_block` para não invalidar templates customizados. Correções de vídeo e foto compartilham o mesmo pool (taxonomia é uma só). Falha de leitura degrada para prompt sem exemplos, nunca derruba a triagem. 5 testes em `tests/test_f8_triage_fewshot.py` cobrindo o ciclo PATCH → prompt.)*

### E2.D — Gramática do Plano (mínimo viável)

- [x] **E2.D1 — Escala de plano** ✅ implementado e retroagido ao acervo em 20/07 — zero-shot CLIP por keyframe contra rótulos fechados (`close-up`, `plano médio`, `plano americano`, `plano geral`, `detalhe`, `aéreo/drone`) → faceta `shot_scale` no payload Qdrant + coluna em `media_segment`.
  *Aceite:* precisão razoável num teste manual com 20 frames variados (≥ ~75%). ✅ **Validado em 60 fotos reais com inspeção visual de contact sheets: ~75–80% agregado.** Com 1 prompt por classe o CLIP decidia por semântica, não enquadramento (maquiagem virava 'close', equipamento em plano aberto virava 'detalhe') — resolvido com **ensemble de prompts por classe** (v2 em `src/vision/shot_scale.py`). Por classe: `plano_geral` excelente (8/8), `close` e `detalhe` bons (3/4, 4/5), `plano_medio` é o balde dominante e certo na maioria; **`plano_americano` é a classe fraca (~50%)** — corte fino de corpo é limitação conhecida do CLIP-B/32 e a taxonomia não tem "plano inteiro"; tratar americano como "médio-longo" ao filtrar.
  **Backfill executado no acervo real SEM re-extração e SEM API** (reusa os vetores já indexados): **7.042 pontos classificados** (keyframes + fotos), **5.618 segmentos** com `shot_scale`/`shot_scale_score`; distribuição: 44% plano médio, 19% detalhe, 17% geral, 12% americano, 6% close, 50 aéreos. Análises novas classificam na indexação (`clip.shot_scale_enabled`, default true; falha degrada sem faceta — lição do E2.A5). Endpoint: `POST /api/project/{id}/facets/backfill-shot-scale` (sincroniza também `category` e `camera_motion` no payload). 3 testes em `tests/test_f9_shot_scale.py` (CLIP real + Qdrant em memória).
- [x] **E2.D2 — Paleta e temperatura** ✅ FOTOS implementadas e retroagidas em 20/07; vídeos ficam incrementais — k-means de cor dominante + classificação quente/neutro/frio por keyframe (OpenCV puro) → facetas `palette_temp`, `palette_hex`.
  *Aceite:* busca filtrada por "tons quentes" retorna entardeceres/interiores de tungstênio. ✅ **Confirmado visualmente**: amostra 'quente' = interiores de tungstênio e escadaria noturna âmbar; 'frio' = céus azuis e cenas com luz azul de cena/giroflex.
  *(20/07: `src/vision/palette.py` (k-means 4 cores + votação de matiz ponderada por saturação/participação; margem mínima evita cinza "com temperatura"). Colunas `palette_temp`/`palette_hex` em `photo`; análise de foto nova calcula na hora; `POST /api/project/{id}/facets/backfill-palette` retroagiu **1.424/1.424 fotos: 860 quentes / 461 neutras / 103 frias**. Na biblioteca: filtro `cor:quente|neutro|frio` + chips "Tons quentes/neutros/frios". **Vídeos**: keyframes não são retidos em disco — a faceta entra incrementalmente nas próximas análises (backfill de vídeo exigiria re-extração FFmpeg; fica para um lote de worker se fizer falta). 5 testes em `tests/test_f10_palette.py`.)*
- [x] **E2.D3 — Facetas na busca** ✅ backend implementado em 20/07 (**chips na UI de busca ainda pendentes**) — query params `shot_scale`, `palette_temp`, `camera_motion`, `category` no search + chips de filtro na UI de busca.
  *Aceite:* "closes" + categoria "depoimento" filtra corretamente. ✅ **Batido na letra em 20/07**: `GET /api/search/visual?q=pessoa falando&shot_scale=close&category=depoimento` retorna só closes de vídeos `depoimento`.
  *(20/07: os 4 filtros no `/api/search/visual`; payload ganha `category` e `camera_motion` na indexação nova E no backfill; **correção de categoria pela UI (E2.C2) sincroniza a faceta no Qdrant na hora** (`sync_category_payload`, com propagação de rajada). Na biblioteca (client-side): `cat:` agora vale para fotos também, além de `cor:` e `revisar:`. Falta: chips de faceta na UI da aba Busca (resultados do servidor) — pendência de UI, backend pronto.)*

### E2.E — Parada de teste (usuário)

- [x] Validar beats em 5 planos-sequência reais; comparar custo de visão antes/depois; aprovar ou ajustar limiares. *(14/07: beats validados em material real — `handcam (70)` e `MVI_3247`; custo medido e projetado nas tabelas acima; limiar de rajada decidido em 0.93. Filtros de faceta ficam de fora — dependem do E2.D, ainda não implementado.)*
- [x] **Revalidar E2.A5/E2.A6 com material real.** *(14/07: revalidação ponta a ponta no vídeo 265 confirmou segmentação alimentando a visão de fato — 66 keyframes reais, zero fallback para relógio fixo.)*
- [x] **E2.E2 — Testar E2.C2 (usuário).** Requer **reiniciar o servidor** (endpoints novos; o :8000 não faz hot-reload) e F5 no navegador. Roteiro: (1) abrir um vídeo no inspetor → aba Índice → mudar a categoria no dropdown "Categoria (Triagem IA)" → conferir que o card/tooltip atualiza e que reabrir o vídeo mostra "confirmada por você"; (2) abrir uma foto de rajada no lightbox → mudar a categoria → conferir aviso "N fotos da rajada"; (3) digitar `revisar:triagem` na busca da biblioteca (aba Fotos) → devem aparecer ~3 fotos com confiança baixa; (4) marcar um vídeo `cotidiano` como `depoimento` e conferir que ele vira tipo "Fala" (interview) na biblioteca.

**Etapa 2 — encerramento (14/07, atualizado 20/07):** E2.A, E2.B (exceto B5), E2.C1, **E2.C2, E2.C3, E2.D1, E2.D2-fotos e E2.D3-backend** concluídos. **Restam da etapa:** E2.B5 (adiado oficialmente para junto do E3.C — sem entidades object/location cadastradas), chips de faceta na UI da aba Busca (D3-UI), paleta retroativa de keyframes de vídeo (D2-vídeos, incremental nas próximas análises) e o roteiro de teste do usuário E2.E2. O E1.T5 **já foi executado** (ver E1.T5 acima).

#### Revalidação do E2.A5/E2.A6 em material real (14/07) — sem gastar API

Reanálise completa do vídeo **265** (`MVI_3476.MOV`, 572s) rodando o `analyze_video_vision` de verdade sobre uma **cópia descartável do banco** (Qdrant temporário; acervo real intocado), com a chamada de visão mockada. Isto prova o caminho que o bug do E2.A5 quebrava — segmentação → keyframes → log — que acontece **inteiro antes da primeira chamada de API**. O que exigiria API real é a *qualidade* da descrição, não o custo (que é a contagem de keyframes, medida aqui).

Resultado: `[Vision] Video 265: categoria='processo' -> esforco 'completo'` → **1 triagem + 66 keyframes = 67 chamadas**, `media_segment` com **39 shots + 17 beats**, 66 frames indexados no Qdrant com as janelas reais dos segmentos (E2.A6). **Zero ocorrências de "Falha na segmentação, usando relógio fixo"** e 66 ≠ 58 (o que o relógio fixo daria) — ou seja, a segmentação está mesmo alimentando a visão. O bug do log está corrigido em material real, não só na fixture.

#### Medições de 14/07 (segmentação local sobre o acervo real, sem custo de API)

Rodadas em 6 vídeos reais (`handcam (70).MTS` 637s, `MVI_2810` 702s, `00050.MTS` 700s, `MVI_3476` 572s, `MVI_3247` 529s, `entrevista-suzana` 2016s), com os defaults atuais (interval 10s, min_gap 2s, HSV, drift 0.35):

| vídeo | duração | segmentos | keyframes | baseline 10s | Δ |
|---|---|---|---|---|---|
| handcam (70) | 637s | 82 (66 shots + 16 beats) | 72 | 64 | **+12%** |
| MVI_2810 | 702s | 32 (32 shots) | 79 | 71 | **+11%** |
| 00050.MTS | 700s | 15 (0+15) | 78 | 70 | **+11%** |
| MVI_3476 | 572s | 56 (39+17) | 66 | 58 | **+14%** |
| MVI_3247 | 529s | 73 (61+12) | 61 | 53 | **+15%** |
| entrevista-suzana | 2016s | 39 (33+6) | 210 | 202 | **+4%** |
| **total** | | | **566** | **518** | **+9%** |

⚠️ **A segmentação NÃO reduz o custo de visão — ela aumenta (~+13%).** O *aceite* do E2.A5 ("contagem de chamadas cai vs. baseline de 10s") **não é atendido**, e isso é estrutural, não um bug: o **piso de cobertura** do `_plan_keyframes` fatia todo segmento maior que `frame_interval` em keyframes de ~`interval`. Como `Σ ceil(dur_i/interval) ≥ ceil(Σ dur_i/interval)`, o total é **matematicamente ≥ baseline** — só cai se houver cortes mais rápidos que `min_gap` (não acontece em material bruto). O ganho real da segmentação é o do **E2.A6 (janela precisa)**, não custo.

**Portanto a economia de API da Etapa 2 vem só de E2.B4 (rajadas) e E2.C1 (perfis de esforço)** — o que torna o E2.C1 pré-requisito ainda mais crítico para o E1.T5 do que o plano supunha.

**Nuance importante:** o piso, sozinho, pede **+51%** de keyframes; quem segura em +13% é o **teto de custo** (`max_frames = ceil(duração/interval) + 8`). Ou seja, o teto está *ativamente cortando* cobertura na maior parte do material bruto — o pipeline hoje opera sempre encostado no teto.

#### 🔴 Defeito de QUALIDADE no teto (14/07) — trechos invisíveis para a busca

O teto não era só uma trava de custo: ele **apagava material do acervo**. `_subsample_uniform` cortava por `np.linspace` **uniforme por índice**, tratando igual uma fatia redundante de um plano de 2 min e um corte distinto de 1s. Resultado: descartava o corte (que vira trecho **não descrito e não indexado — a busca nunca o encontra**) e mantinha dez fatias quase idênticas do mesmo plano. O pior dos dois mundos: perde-se cobertura *e* o que sobra é redundante.

Em 2 dos 4 vídeos medidos o teto é **menor que o número de trechos distintos**, então a perda era garantida por aritmética:

| vídeo | trechos distintos | teto | trechos sem nenhum keyframe |
|---|---|---|---|
| handcam (70) | **82** | 72 | **≥ 10** |
| MVI_3247 | **73** | 61 | **≥ 12** |
| MVI_3476 | 56 | 66 | cobrível |
| MVI_2810 | 32 | 79 | cobrível |

**Corrigido:** `_cap_keeping_coverage` inverte a prioridade — a fatia central de cada segmento (`_representa_trecho`) é a **última** a ser cortada; as fatias extras de planos longos disputam só a folga do orçamento. Quando o teto não comporta nem 1 por trecho, aí sim espalha no tempo (não há escolha boa). Guardado por 2 testes de regressão em `test_f3_segmentation.py`. **O custo não muda** (o teto é o mesmo) — muda *quais* frames se paga: cobertura em vez de redundância.

**Sweep do piso de cobertura** (4 vídeos, 2.440s, com o teto real aplicado):

| piso | keyframes | vs. relógio fixo 10s |
|---|---|---|
| **10s (atual)** | 278 | **+13%** |
| 20s | 249 | +1% |
| 30s | 234 | −5% |
| sem piso (1/segmento) | 207 | −16% |

**Decisão sobre o piso — recomendação revista (prioridade: qualidade).** Eu havia sugerido afrouxar o piso para ~30s para economizar. **Retiro a sugestão.** O piso é o que garante que um plano-sequência de 2 min não fique com 1 frame só: afrouxá-lo troca ~5% de custo por buracos de cobertura dentro de planos longos — exatamente o material mais rico do acervo (câmera na mão andando pelo set). Economia que produz busca pior é prejuízo. **Manter o piso em `frame_interval`.** Se algum dia o custo apertar, o lugar certo de cortar é a redundância (E2.C1, rajadas), não a cobertura.

**Qualidade dos beats:** em plano-sequência real (`handcam (70)`, câmera na mão andando pelo set) os beats acompanham a mudança de conteúdo. Já `00050.MTS` (700s) é **câmera esquecida ligada apontada para uma parede** — os beats picotam quadros quase idênticos por deriva de exposição. Material assim existe no acervo e custaria ~70 chamadas por arquivo no baseline: é exatamente o caso que o E2.C1 (`tecnico`/`pessoal` → 2 keyframes) precisa capturar na triagem.

**Escopo real do E1.T5:** o `analyze-all-vision` só varre `video_type IN ('broll','unknown')` = **529 vídeos (12,9h)**; as 12 entrevistas vão por transcrição. Baseline ≈ **5.432 chamadas** de visão (4.903 keyframes + 529 triagens); com a segmentação atual ≈ **6.069**.

#### Projeção do E1.T5 (529 vídeos + 1.424 fotos), com os números medidos

#### ✅ Amostra de triagem executada (14/07) — o mix real do acervo

30 vídeos sorteados por **amostragem estratificada** (origem × duração; seed 20260714) entre os 519 sem categoria. **30 chamadas de visão reais gastas**, 2,5 min, **triagem bem-sucedida em 30/30** (confiança média 0,90). As categorias foram gravadas no banco real de propósito — o `analyze_video_vision` só triaga `if not category`, então o E1.T5 reaproveita e não paga essas 30 de novo.

| categoria | n | % | esforço |
|---|---|---|---|
| `processo` | 15 | 50,0% | completo |
| `obra` | 8 | 26,7% | completo |
| `tecnico` | 4 | 13,3% | reduzido |
| `cotidiano` | 2 | 6,7% | triagem |
| `evento` | 1 | 3,3% | completo |

**Mix de esforço real: 80% completo / 13% reduzido / 7% triagem** — ou seja, o **cenário pessimista** que eu havia projetado. Faz sentido e não é defeito: num making of, o acervo é majoritariamente `processo` + `obra` (77%), que é exatamente o material que *merece* análise completa. **Perfil de esforço economiza pouco quando quase tudo é o assunto principal.** Títulos gerados são específicos e sem viés ("Prep. de cabelo e maquiagem", "Ajustes de cor e HDR", "Testes de câmera no escuro").

#### Projeção do E1.T5 (529 vídeos + 1.424 fotos) — **com o mix medido**

| cenário | chamadas de visão | vs. baseline |
|---|---|---|
| **A) Baseline pós-Etapa-1** (relógio 10s, 1 chamada/foto) | **6.856** | — |
| **B) Hoje, sem E2.C1** (segmentação +13%) | **7.463** | **+9%** |
| **C) com E2.C1, mix real 80/13/7** | **6.343** | **−7%** |
| **D) C + rajadas a 0.93** | **6.078** | **−11%** |

Ganho isolado do **E2.C1: −15%** (C vs. B). Ganho isolado das **rajadas a 0.93: −4%** (D vs. C).

⚠️ **Conclusão honesta: a Etapa 2 inteira entrega ~−11% de custo no E1.T5, não os −26/−29% que a projeção otimista sugeria.** Sem o E2.C1 a rodada sairia **+9% mais cara** que antes da Etapa 2 — então o C1 continua sendo pré-requisito, mas para *neutralizar* o custo que a segmentação adiciona, não para gerar economia grande. O ganho real da Etapa 2 é **qualitativo** (janelas de busca precisas, busca visual CLIP, rajadas, triagem), não de custo. A premissa do cabeçalho ("Custo de API esperado: cai") só se sustenta na margem.

---

## PRÓXIMA SESSÃO — prioridades preparadas (20/07)

> Especificado com detalhe de execução para começar direto. Ordem pensada: P0 é dívida de confiabilidade que já custou horas de diagnóstico; P1–P3 antecipam o pedaço de **roteiro** da Etapa 3 (o roteiro real já está no banco e o usuário quer usá-lo na edição). Itens da Etapa 3 antecipados aqui saem da Etapa 3.

### P0 — Aviso de "índice de busca indisponível" (fim do silêncio do Qdrant) ✅ implementado em 20/07/2026

**Motivação real:** em 19–20/07 o usuário usou a instância da porta 8001 (sem o lock do Qdrant) e todas as buscas voltaram **vazias sem nenhum aviso** — horas de confusão que um banner teria evitado.

- [ ] **P0.5** Teste: monkeypatch do client Qdrant levantando exceção (NUNCA subir 2ª instância real — lock).
*Aceite:* com o Qdrant tomado por outra instância, a busca mostra o aviso (não vazio) e o health aponta o problema.

### P1 — E3.C0 (novo): dedupe e versão de documentos no upload

**Motivação real:** em 20/07 o mesmo roteiro entrou 2x (`.txt` id 3 com 133.547 chars e `.pdf` id 8 com 132.158) → chunks duplicados no RAG, respostas do chat puxando o mesmo trecho 2x. Não há nenhuma proteção hoje (`production_doc` nem tem hash; fotos/vídeos têm).

- [ ] **P1.1** Migração: `byte_hash` (sha256 dos bytes) e `content_hash` (sha256 do texto extraído normalizado: minúsculas + espaços colapsados) em `production_doc`.
- [ ] **P1.2** Upload: `byte_hash` idêntico → 409 "documento idêntico já existe"; `content_hash` idêntico → 409 "mesmo conteúdo em outro formato (id X)"; similaridade de texto > ~0.9 (difflib/embedding) → resposta "possível nova versão de X" com opção `replace_doc_id` que **apaga os chunks antigos do Qdrant** e o doc antigo antes de indexar o novo.
- [ ] **P1.3** UI: diálogo no upload com as 3 situações (idêntico/mesmo conteúdo/nova versão).
- [ ] **P1.4** Sessão: limpar a duplicata atual do usuário (decidir com ele: manter o `.txt` id 3, apagar o `.pdf` id 8 — o PDF perdeu ~1.400 chars na extração).
*Aceite:* subir o mesmo roteiro em pdf e txt não cria dois docs; subir "v5" oferece substituir a "v4".

### P2 — E3.C1 antecipado: extração estruturada do roteiro + bloco de contexto compacto

**Este é o "sistema para diminuir tokens mantendo os dados": extrai UMA vez (estruturado, com cache), injeta sempre um bloco compacto — nunca o roteiro inteiro.**
Números do acervo real: roteiro = 133.547 chars ≈ **~33k tokens**. Extração única em ~6 chunks de ~6k tokens no modelo de texto barato (DeepSeek) ≈ 40k entrada + ~5k saída = **centavos, uma vez por versão do roteiro** (cache por `content_hash` — P1). Depois disso, o que circula nos prompts é um bloco de **~1,5–2k tokens**.

- [ ] **P2.1** Prompt `script_extract` no PROMPT_REGISTRY (com `label`/`category`/`variables`): entrada = chunk do roteiro; saída JSON = personagens (nome + 1 linha), cenas (número, heading, sinopse de 1 frase, personagens, props, locação), objetos-chave. Chunking com sobreposição de 1 cena; fusão dos resultados por número de cena.
- [ ] **P2.2** Tabela `scene(project_id, doc_id, number, heading, synopsis, characters_json, props_json, location, created_at)` (migração segura) + entidades sugeridas em `entity` com `status='suggested'` (coluna nova; só `confirmed` entra em prompts — regra do E3.C3 original).
- [ ] **P2.3** Cache: extração roda 1x por `content_hash`; re-upload da mesma versão reusa.
- [ ] **P2.4** `script_context_block` compilado (~1,5–2k tokens: logline + personagens confirmados + locações + props) injetável em `triage`/`vision` via setting `context.script_block_enabled` (**default false** até validar em ~10 reanálises A/B — convenção anti-viés: o bloco descreve o UNIVERSO do filme, nunca afirma que o material É do filme).
- [ ] **P2.5** UI mínima de curadoria (E3.C3 do plano): lista de personagens/cenas extraídos com aceitar/rejeitar em massa (aba Docs → botão "Extrair estrutura").
*Aceite:* roteiro real extraído com cenas/personagens conferíveis pelo usuário; custo de extração logado; reanálise de 5 itens com o bloco ligado mostra nomes/termos do filme nas descrições sem inventar vínculo.

### P3 — E3.C5 (novo): casamento cena ↔ material + relatório de cobertura

**O uso do roteiro que ajuda a EDIÇÃO de verdade** (e só depende do P2):
- [ ] **P3.1** Cada cena vira uma busca semântica pronta (sinopse + locação + personagens) contra vídeo+foto; sugestões gravadas em `scene_media(scene_id, media_kind, media_id, score, status 'sugerido'/'confirmado'/'rejeitado')`.
- [ ] **P3.2** Relatório de cobertura: cenas sem material sugerido (buracos), material forte sem cena (sobras/b-roll livre).
- [ ] **P3.3** UI: painel "Cenas" (lista com contadores de material por cena; clicar → resultados no painel de busca; confirmar/rejeitar vínculos).
*Aceite:* "mostrar material da cena X" funciona; relatório aponta pelo menos os buracos óbvios (validar com o usuário).

### Pendências que continuam na fila (sem mudança)

- Chips de faceta na UI da aba Busca (E2.D3-UI) — backend pronto, falta só interface.
- Fixtures do `test_f4_bursts` no limiar (chip de tarefa já criado em 20/07).
- Roteiro de teste do usuário **E2.E2** (dropdowns de categoria, `revisar:triagem`, rajadas).
- E2.D2-vídeos (paleta de keyframes) — incremental nas análises novas; backfill exigiria re-extração FFmpeg (lote de worker, se fizer falta).

### Nota de formato de roteiro (referência para o usuário)

Para ESTE pipeline: **`.fountain` ou `.txt` > `.fdx` > `.pdf`**. O Fountain/txt preserva estrutura em texto puro (headings `INT./EXT.` são âncoras de cena para o P2); o `.fdx` (Final Draft) já é parseado com tipos de parágrafo; o **PDF é o pior** — a extração de texto perde estrutura e conteúdo (medido no roteiro real: o `.pdf` chegou com ~1.400 chars a menos que o `.txt` do mesmo roteiro, além de quebras de linha no meio de frases que poluem o chunking do RAG).

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

> ⚠️ **(20/07) Parcialmente antecipado para a seção "PRÓXIMA SESSÃO":** E3.C1 (extração) = P2, parte do E3.C3 (curadoria) = P2.5, e nasceram lá o E3.C0 (dedupe de docs = P1) e o E3.C5 (cena↔material = P3). Ao executar, marcar aqui também. O que fica exclusivo desta etapa: E3.C2 (vínculo entity↔scene completo), E3.C4 (ficha técnica → galeria facial) e a integração com o Cartão de Contexto (E3.A3).

- [ ] **E3.C1 — Extração de roteiro** — Prompt `script_extract` (chunking p/ roteiros longos): personagens (nome+descrição), cenas (número, sinopse, personagens, props, locação), objetos-chave. Suporte a PDF/DOCX/TXT/Fountain (o upload de docs já existe). *(→ P2 da próxima sessão)*
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
