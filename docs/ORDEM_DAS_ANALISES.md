# Ordem das análises na ingestão e reanálise

Levantamento lendo o código (sem rodar). Referências `arquivo:linha` em `src/`.

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
