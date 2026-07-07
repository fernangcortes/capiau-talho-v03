# Implementação: Enriquecimento de IA, Timeline Multipista e Temas por Segmento

Registro técnico da sessão que implementou os 3 pedidos principais (nomes nas descrições, timeline multipista com pista de IA, agrupamento temático v2). Compatível com as mudanças da sessão paralela de UI (popouts/splitters/chat wide) — auditado sem conflitos; o chat.js novo já usa a API `TIMELINE_STATE.addCut(videoId, in, out, null)` com roteamento automático.

---

## 1. Nomes de pessoas/objetos nas descrições (persistido + buscável)

**Problema resolvido:** o enriquecimento era regex em tempo de leitura, nunca salvo — a busca vetorial só via termos genéricos (e a regex mutilava texto, ex: "UmYasmim Sant'Anna").

**Arquitetura nova:**
- `src/db/repositories/entities.py` + tabelas `entity` / `entity_mention` (schema.py): pessoas, objetos e locações como entidades canônicas com menções por mídia/timestamp, fonte (`vision_auto|face_recognition|human_audit|text_link`) e status.
- `src/nlp/enrichment_engine.py`: reescrita da descrição via LLM (com fallback regex), **persistência** (photo.description + `photo.raw_description` preserva original; payload Qdrant ganha `raw_text`, `entity_names`, `enrich_key` de idempotência) e **reindexação** do embedding (`SemanticSearch.update_point_text`).
- Gatilhos automáticos: rotular face/cluster, merge, reassign, face manual, reject-como-objeto (faces.py) → enriquecimento em background das mídias afetadas.
- Visão estruturada: `get_vision_prompt()` injeta entidades conhecidas do projeto + pessoas confirmadas por rosto no frame; saída agora tem `pessoas[]`/`objetos[]` e gera menções `vision_auto` para matches exatos.
- Guard de idempotência na regex legada (rag.py): nomes já presentes no texto não são reinseridos.

**Rotas novas:**
- `GET /api/entities/project/{id}` · `POST /api/entities` · `PATCH/DELETE /api/entities/{id}` (rename re-enriquece as mídias afetadas)
- `POST /api/entities/project/{id}/enrich` (`?video_id=` ou `?photo_id=` para escopo)
- `POST /api/entities/project/{id}/backfill-legacy` — migra face.name legado (JÁ EXECUTADO no projeto 2: 24 entidades, 434 menções)

**Validado:** vídeo 265 reescrito ("Yasmim Sant'Anna sentada sendo maquiada…") e ranqueando 1º na busca vetorial.

## 2. Timeline multipista + pista de IA real

- `timelineState.js`: modelo dinâmico `tracks[]` (id, name, kind `video|ai`, volume, muted, locked, **magnetic**). Padrão: AI (travada) / V2 B-Roll (livre) / V1 Falas (magnética). `addVideoTrack/removeTrack/rename/toggleMute/Lock/Magnetic`, scroll vertical, `serializeTracks()`.
- `state.js`: layout por pista — magnética = ripple sequencial; livre = posição absoluta preservada.
- `timelineRenderer.js`: lanes dinâmicas com paleta rotativa, pista de IA (verde) recebe ghosts INSERT/REPLACE; DELETE desenha hachura sobre o clipe alvo na pista original.
- `panels.js`: cabeçalhos de pista gerados dinamicamente (`#timeline-track-headers`), botão `+` cria pista, duplo-clique renomeia; compatível com popouts via `getActiveElement`.
- **Persistência v2**: `sequence_json = {version:2, fps, tracks[], clips[{…, timeline_start}]}` com migração automática v1→v2 (`ProjectRepository.parse_sequence`). `GET /api/timeline/{id}` carrega; botão 📂 na UI restaura pistas+posições.
- Export OTIO/XML com pistas nomeadas e Gaps de posicionamento; EDL achata via `flatten_stack` (instalados `otio-fcp-adapter` e `otio-cmx3600-adapter` — eram a causa do 500 pré-existente).
- **Sugestões reais** (substituem as personas fake com setTimeout): `POST /api/timeline/ai-suggest` → `src/services/timeline_ai.py` monta contexto real (transcrição exata dentro do in/out de cada clipe, descrições visuais enriquecidas, lacunas de fala sem cobertura) + catálogo de candidatos, prompts por persona (`TIMELINE_PERSONAS` em prompt_templates.py), resposta validada (ids existentes, durações clampadas). Botão ✨ no header e na pista de IA.

## 3. Agrupamento temático v2 (por segmento)

- `src/nlp/theme_engine.py`: coleta blocos de fala + frames de b-roll (texto enriquecido) + fotos → embeddings locais MiniLM → AgglomerativeClustering (fallback DBSCAN NumPy) → LLM só nomeia clusters (reutilizando títulos existentes) → grava `theme_segment` (mídia + start/end + excerpt + relevância) e centroide em `theme.embedding`.
- Atribuição incremental: mídia nova transcrita/analisada entra nos temas existentes por similaridade de centroide (`assign_media_to_themes`), sem re-clusterizar.
- `GET /api/themes` retorna `segments_count`; `GET /api/theme/{id}/segments` lista trechos; UI de temas tem badge + "Ver Trechos" com seek no player.
- **Executado no projeto 2:** 316 segmentos, temas novos transversais (Luz e Fotografia 44, Equipamento de Áudio 33…).

## Rodada 2 (correções e pendências executadas)

### Player multipista (bug "piscando travado")
Três causas eliminadas em player.js / timelineState.js / state.js / timelineInteraction.js:
1. **Seek-loop**: `currentTime` era forçado a cada tick com deriva > 0.1s; cada seek trava o decoder e realimenta a deriva. Agora a deriva é corrigida suavemente via `playbackRate` (0.92/1.08) durante o play; seek duro só em troca de clipe, scrub pausado ou deriva > 1s.
2. **Troca de elemento no meio do play**: quando o clipe de baixo acabava, o de cima "migrava" do elemento B para o A (reload de src = flash preto). Agora os papéis são estáveis (clipe fica no elemento onde já toca).
3. **Frames em fps do vídeo fonte**: clipes 30/60fps ocupavam 25–150% mais timeline do que têm de mídia (fim congelado). Frames de clipe agora são SEMPRE em fps da timeline.

### Rostos em fotos (nomes ausentes)
Diagnóstico: as 1424 fotos **nunca tiveram detecção facial** (o gancho `process_photo_faces` só roda no ingest, e o acervo foi ingerido antes dele existir); além disso o botão "Agrupar (DBSCAN)" lia embeddings apenas de `face_recognition` (vazia — os embeddings reais estão na coluna legada `face.embedding`), ou seja, não fazia nada.
- `FaceService._get_faces_with_embeddings`: fallback para embeddings legados (botão da UI volta a funcionar).
- `_get_cluster_suggested_name`: prefere nomes REAIS (ignora placeholders 'Pessoa Desconhecida') e promove placeholders quando o cluster ganha nome real.
- **Novo** `POST /api/faces/project/{id}/recover-photo-faces`: detecta rostos localmente em todas as fotos sem detecção → re-clusteriza (fotos herdam os nomes dos vídeos) → registra menções de entidades → re-enriquece descrições do projeto inteiro. Progresso na aba Tarefas. **Não refaz análise de visão paga.**

### Temas: merge automático + clustering robusto
- `merge_similar_themes`: union-find por título normalizado / similaridade de embedding de título (≥0.82) / similaridade de centroide (≥0.86); canônico = pinned > mais segmentos; reaponta theme_segment/transcript_theme/relation e apaga duplicatas.
- `cleanup_empty_themes`: remove temas sem segmentos e não fixados (restos legados).
- Rodada de clustering agora é REBUILD completo do mapa de segmentos (sem órfãos), com teto de 40 clusters e nomeação por LLM em lotes de 18 — escala para qualquer projeto futuro. Tudo integrado ao botão "Agrupar temas".

### Busca em português (modelo multilíngue)
- `CONFIG.embedding_model` agora lê `EMBEDDING_MODEL` do .env com default `paraphrase-multilingual-MiniLM-L12-v2` (384d, mesmo tamanho de coleção).
- **Novo** `POST /api/search/reindex`: re-embeda todo o acervo com o modelo atual (progresso na aba Tarefas) e invalida centroides de temas antigos.

### Outras
- Timeline de teste id=3 apagada. Adaptadores OTIO fcp_xml/cmx_3600 instalados (export XML/EDL funcionando; EDL achata multipista).
