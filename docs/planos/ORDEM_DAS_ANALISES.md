# Ordem das análises na ingestão e reanálise

Levantamento lendo o código (sem rodar) em 05/10/2026. Referências `arquivo:linha` em `src/`.

> **Atualizado em 06/10/2026.** As seções 1 a 5 são o levantamento original (linhas de
> 05/10, podem ter andado). O que foi corrigido e implementado está na **seção 6**; o que
> ficou de fora, na **seção 7**.

## 1. Ordem real hoje

A ingestão (`services/ingest.py`) só registra, gera proxy e miniaturas; **não dispara nenhuma IA**. A ordem depende de qual rota/worker o usuário aciona:

| Caminho | Ordem |
|---|---|
| `analyze_video_all` (`pipeline.py:1628`) | ASR (1648) -> visão (1663; triagem dentro dela) -> **rosto de 1 frame** (1689) |
| Lote de visão (`vision_batch.py:60`, `worker_vision.py`) | só visão; **pula `interview`** (`vision_batch.py:29-46`) |
| ASR em lote (`worker_transcricao.py:47`, `media.py:836`) | só ASR; independe da visão |
| Reanálise por vídeo (`media.py:994`) | só `analyze_video_vision` |

Dentro de `analyze_video_vision` (`pipeline.py:702`): Laya (722) -> triagem por visão (724) -> perfil de esforço (750) -> segmentação -> **por keyframe**: rostos (858) -> objetos (864) -> pessoas confirmadas (868-880) -> visão (892) -> menções -> CLIP (com categoria) -> fim: Qdrant, resumo (978), enriquecimento, temas (992).

## 2. Tabela de dependências

| Análise | LÊ de | ESCREVE | Roda |
|---|---|---|---|
| ASR (`transcribe_video` 402) | `video_type` (VAD pula broll/unknown mudo, 428) | transcrição, entidades, resumo "interview" (487), temas (494) | antes ou depois da visão, conforme o gatilho |
| Laya (`triage_system1` 279) | nome, pasta, duração, áudio, **transcrição se existir** (294-304). Sem imagem | `system1_decisao`; categoria só em modo `decide` | 1ª na visão |
| Triagem por visão (`triage_video` 143) | 4 frames, nome/pasta, **transcrição se existir** (171-180), entidades, correções humanas (`prompt_templates.py:32`) | category, confiança, título, `video_type` | 2ª, só `if not category` |
| Perfil de esforço (`analysis_policy.py:127`) | category | nº de keyframes/beats | após triagem |
| Rostos (`face_engine.py:199`) | frame | face (nome NULL) | por keyframe |
| Objetos (`_detectar_objetos_frame` 239) | frame, `object.classes_filter` | `detected_object` | por keyframe; **sem filtro de categoria**; padrão `none` |
| Visão (`get_vision_prompt` 212) | category, entidades, pessoas confirmadas, roteiro (off) | descrição, tags, menções | por keyframe |
| CLIP | frame, category | vetor + payload | por keyframe |
| Resumo (`generate_video_summary` 1281) | category (só broll, 1305), descrições ou transcrição | título/descrição/tags do vídeo | fim de cada fluxo |
| Temas (`theme_engine.py:537`) | textos já gravados | segmentos de tema | fim de ASR **e** de visão |

## 3. Problemas encontrados

**(a) Análise sem contexto que poderia ter**
1. Via lote de visão ou reanálise, a triagem roda sem transcrição se o ASR não rodou antes (`pipeline.py:171-180` e `294-304` só usam "se existir"). Nada garante ASR primeiro; só `analyze_video_all` o faz. O lote ainda exclui `interview`, então depoimento nunca passa por triagem no lote.
2. O resumo de entrevista não recebe categoria (`pipeline.py:1309`, sem `category=`); o de b-roll recebe.
3. **Pessoas confirmadas quase nunca chegam à visão.** `process_video_frame_faces` apaga as faces do timestamp e reinsere com `name=NULL` (`face_engine.py:206,213`) imediatamente antes da consulta de nomes (`pipeline.py:868-880`). Na primeira análise não há nome; na reanálise o nome confirmado nesse frame é apagado. O contexto facial só existiria se outra rota renomeasse antes. Verificar com um vídeo reanalisado.
4. Resumo de entrevista e de b-roll gravam no mesmo campo (`update_video_metadata`, 1364): vence o último a rodar; a ordem ASR/visão decide o resultado.
5. Temas rodam duas vezes (494 e 992); a 1ª só vê a transcrição.

**(b) Contexto que PIORA (viés de confirmação)**
- Dar à checagem B a descrição/objetos da visão faz ela concordar com a visão (mesmo erro nos dois). Hoje a visão **não** recebe `detected_object` (o prompt só usa entidades conhecidas, `prompt_templates.py:222`); essa independência já existe e deve ser mantida nos dois sentidos.
- Laya em `decide` lê só texto (nome/pasta/fala) e substitui a triagem por visão (`pipeline.py:305-316`): categoria decidida sem ver imagem.
- Categoria entra no prompt da visão (`prompt_templates.py:215`): "descreva dentro desse contexto" induz a descrição a confirmar a categoria.

**(c) Erro que se propaga**
- Triagem errada -> perfil (`analysis_policy.py:50-59`): `cotidiano`/`pessoal` = 2 keyframes (`max_keyframes=2`); `tecnico`/`arquivo`/`documento` sem cobertura. Uma `obra` classificada como `cotidiano` fica com 2 frames: descrição pobre e B cego.
- Triagem só roda `if not category` (722): a categoria errada nunca é revisitada na reanálise.
- Correção humana (`media.py:195-229`) atualiza categoria, `video_type` e payload CLIP, mas **não reaplica o perfil nem reanalisa**: descrições, beats e keyframes seguem os da categoria antiga. Corrigir para `depoimento` muda para `interview` e o tira do lote de visão.
- Bug colateral: `pipeline.py:1689` chama `extract_frame(filepath, sample_frame, sample_ts)` com argumentos trocados (assinatura em `media/ffmpeg.py:167` é vídeo, tempo, saída). O try/except engole; o rosto de `analyze_video_all` provavelmente nunca roda.

## 4. Ordem recomendada

1. ASR primeiro quando houver fala (VAD barato antes). Transcrição é o melhor contexto de triagem.
2. Laya em **sombra**: roda depois do ASR, só registra. Não decide categoria até a comparação com a triagem por visão mostrar acerto; em `decide`, exigir confiança alta e nunca cortar esforço (só subir).
3. Triagem por visão (frames + transcrição).
4. Perfil de esforço, com piso: categoria de baixa confiança (`< triage.min_confidence`) usa `completo`.
5. Visão por keyframe, rostos antes dela.
6. Resumo e temas **uma vez**, no fim.
7. **Checagem B** (novo): só `category == 'obra'`, sob pedido (chat/manual), **fora do loop principal**, depois da categoria estar firme (confiança 1.0 humana ou acima do limiar). Roda **independente**: recebe só frames e `object.classes_filter`, nunca a descrição da visão. Contexto da visão pode entrar apenas para **descartar** (ex.: visão diz "boom em cena de making of"/pessoa da equipe com crachá), nunca para confirmar. Resultado como "suspeita" para revisão humana, com frame e caixa.
8. Triagem mudou depois: não reprocessar tudo. Se a mudança alterar o perfil (completo para reduzido ou o inverso), marcar o vídeo como "análise desatualizada" e oferecer reanálise; subir esforço reprocessa, descer não apaga nada.

## 5. Mudanças pequenas e testáveis

1. `pipeline.py:1689`: corrigir ordem dos argumentos de `extract_frame`. Teste: mock de `extract_frame` verificando `(video, tempo, saída)`.
2. `face_engine.py:206`: preservar `name` de faces confirmadas ao reprocessar o timestamp (ou só apagar `status='auto'`, como `face_service.py:1100`). Teste: face nomeada sobrevive à reanálise e chega em `detected_people`.
3. `pipeline.py:722`: antes de `triage_video`, se o vídeo não tem transcrição e tem áudio, `transcribe_video` primeiro; ou registrar `triagem_sem_transcricao` no log. Teste: triagem recebe `transcript_snippet`.
4. `pipeline.py:1309`: passar `category` ao resumo de entrevista (assinatura de `get_interview_summary_prompt`, `prompt_templates.py:325`, a estender).
5. `analysis_policy.get_profile`: parâmetro `confianca` (novo) que força `completo` abaixo do limiar. Teste em `tests/` de política.
6. `media.py:195`: após corrigir categoria, marcar `analise_desatualizada` (novo campo) se o perfil mudou.
7. `pipeline.py:1281`: não deixar resumo "broll" sobrescrever o de "interview" quando há transcrição (ou mesclar).
8. Checagem B (novo): `src/services/checagem_set.py` (novo) + rota em `media.py` + ferramenta no chat de onboarding. Teste: não roda fora de `obra`; não lê `descricao`.

## 6. O que mudou em 06/10/2026

Um commit por item, todos com teste em `tests/test_ordem_analises.py` (banco SQLite em memória,
IA, ffmpeg e detector falsos).

### Ordem nova

| Caminho | Ordem |
|---|---|
| `analyze_video_all` | ASR **só se não houver transcrição** (`forcar_asr=True` retranscreve) -> visão (`finalizar=False`) -> rosto de 1 frame -> **resumo e temas uma vez** |
| Visão (lote, reanálise, `analyze_video_all`) | **ASR se tem áudio e não tem transcrição** -> Laya (sombra) -> triagem por visão -> perfil **com piso** -> por keyframe: rostos -> objetos -> pessoas confirmadas -> visão -> CLIP -> fim: Qdrant, **keyframes no SQLite**, resumo mesclado, enriquecimento, temas |
| ASR avulso | inalterado; o resumo agora inclui a imagem já gravada |

### Bugs corrigidos

1. **Rosto nomeado sumia na reanálise** (`face_engine.py`, `_substituir_faces_automaticas`).
   Antes: `DELETE` de todas as faces do instante e regravação com `name = NULL`; o `ON DELETE
   CASCADE` levava as confirmações de `face_recognition`. Agora só sai face automática (sem nome
   ou com nome provisório "Pessoa Desconhecida…", e sem reconhecimento humano). Nome real,
   descarte ("Não Relevante", "Não é Rosto") e confirmação ficam. Detecção nova que cai na caixa
   de uma face curada (IoU >= 0,5, janela de 0,5 s) não é regravada: a antiga segue com id, nome
   e confirmações, e o nome chega a `detected_people` do prompt de visão. Vale também para fotos.
   - Medição antes da correção (banco real, só leitura): 1.300 faces de vídeo com nome real, 909
     confirmadas. Comparando com os 4 backups de `data/`, **nenhum nome tinha sido perdido**: os
     34 "sumidos" desde 08/07 são renomeações suas (mesmo id de face, nome trocado).
2. **Camada de rosto de `analyze_video_all` nunca rodava.** Eram dois erros, não um:
   `CONFIG.FRAMES_DIR` não existe (AttributeError) e `extract_frame` recebia (vídeo, saída, tempo).
3. **Colateral:** `proxy_path` só existia dentro do bloco de segmentação; com
   `vision.use_segments` desligado, o `extract_frame` dos keyframes dava NameError.

### Itens 3 a 6

3. **Transcrição antes da triagem** (`_transcrever_antes_da_triagem`). Decisão: transcrever
   antes. O VAD local de `transcribe_video` descarta b-roll mudo sem custo; falha do ASR não para
   a visão e fica no log da tarefa como `triagem_sem_transcricao`. A Laya continua em sombra,
   agora depois da fala (item 7).
4. **Piso de esforço** (`analysis_policy.categoria_incerta`, `get_profile(..., confianca=,
   limiar=, categoria_laya=)`). Incerta = confiança vazia, abaixo de `triage.min_confidence` ou a
   **Laya discordando**. Correção humana (1,0) manda. O piso só sobe esforço. A discordância
   entrou porque a confiança declarada pelo modelo não discrimina: 21 dos 22 vídeos triados estão
   com >= 0,8. A fila de revisão (`/api/project/{id}/triage/review`) usa a mesma regra e devolve
   `categoria_laya`.
5. **Análise desatualizada** (`media.py`, `_analise_desatualizada`). Colunas novas em `video`:
   `esforco_analisado` (gravada pela visão) e `analise_desatualizada` (motivo, ou NULL). A
   correção humana só **marca e oferece** (`reanalise: {metodo, rota}` na resposta) quando o
   esforço sobe; descer não marca nem apaga; voltar à categoria anterior desfaz; vídeo que nunca
   passou pela visão não é marcado. A reanálise limpa a marca. Interface: fica para a sessão de UI.
6. **Resumo único e temas uma vez.** `generate_video_summary` junta fala + imagem + categoria
   (prompt novo `video_summary`; só fala ou só imagem usa os de antes, agora com categoria).
   Tabela nova **`video_keyframe`**: a descrição de cada keyframe passa a existir no SQLite (antes
   só no Qdrant). Análises antigas caem no Qdrant como reserva. Temas: uma vez no fim de
   `analyze_video_all`; fluxos avulsos seguem com os seus.

## 7. Achados que ficaram de fora (para decidir)

- **Qdrant `capiau_images` corrompido** ("database disk image is malformed"): derruba a busca
  inteira, inclusive a de texto (íntegra, 7.319 pontos). Só 81 vetores, 80 legíveis. Conserto
  proposto: renomear o arquivo e recriar com os 80, com o servidor parado.
- **Plano EmbeddingGemma 2** (branch `ccr-760500b3-ihwuzl`, item 1.4): supõe ler as descrições
  do SQLite. Até hoje elas só existiam no Qdrant; `video_keyframe` resolve isso **para as análises
  novas**. Para as antigas, ou se exporta do Qdrant para `video_keyframe` (sem custo de API), ou
  a reanálise completa preenche.
- `get_video_vision_frames` (Qdrant) lê no máximo **100 pontos** por vídeo (`limit=100`, sem
  paginar): a exportação de `sync.py` e a reserva do resumo cortam vídeos longos.
- `face.embedding` (onde o `face_engine` grava) não está no `SCHEMA_SQL` nem em migração: só
  existe em bancos antigos. Num banco novo (`init_db`) a detecção de rosto falha em silêncio.
  `video.metadata_origem` existe só por migração (testes com `SCHEMA_SQL` precisam acrescentar).
- O vídeo 555 tem categoria `Trilha`, fora da taxonomia: algum caminho grava sem validar.
- `vision.frame_interval` global está em **4 s**: a reanálise completa (18,7 h) dá ~16 mil
  keyframes no esforço completo.
- Lote de visão continua pulando `interview` (`vision_batch.py`).
- Módulos legados (`transcription/asr_engine.py`, `vision/multimodal_engine.py`,
  `nlp/summary_engine.py`) têm o próprio resumo e não seguem esta ordem.
- Checagem B (item 8 da seção 5): não implementada.
