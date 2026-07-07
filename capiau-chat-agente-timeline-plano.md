# Plano — Chat-Agente Integrado à Timeline (CapIAu-Talho)

Data: 2026-07-07. Decisões tomadas em conversa com o usuário.

## Objetivo

Transformar o chat RAG atual num **agente de edição** com acesso total ao contexto do
programa (timeline multipista, acervo, manual do app), especialista em edição NLE e em
**MLT XML / .kdenlive**, capaz de executar operações reais de edição via conversa.

## Decisões de produto (fechadas)

| Tema | Decisão |
|---|---|
| Autonomia | **Híbrido por risco**: inserções/ajustes simples aplicados direto (com undo); operações destrutivas/em massa viram preview (ghost clips) para aprovação. |
| Alternativas | Todo clipe inserido pela IA carrega **alternativas**: hover no clipe abre carrossel popup com outros candidatos + explicação curta de por que cada um serve. |
| Troca de alternativa | **Slot fixo** por padrão (mesma posição/duração, trecho da fonte ajustado); card mostra a duração ideal do candidato com botão "usar duração sugerida" (aplica com ripple). |
| Contexto do chat | Timeline completa (clipes, pistas, playhead, conteúdo real dos trechos, lacunas de cobertura) + acervo RAG (aprimorado) + manual do programa. Estado da UI/tarefas ficou de fora. |
| Arquitetura LLM | **Agente com tools** (loop de function-calling via OpenRouter). |
| Modelo | **Configurável pelo usuário** — dropdown no painel do chat + `AGENT_MODEL` no `.env`. Line-up curado incluindo modelos chineses (Kimi K2, GLM, MiniMax, DeepSeek), Gemini e Claude. |
| NLE alvo | **Kdenlive 24.x/25.x** (documento MLT v1.1+) como formato principal; `.kdenlive` novo, XML/EDL/OTIO mantidos. |
| Áudio | **Pistas de áudio reais** (A1/A2...) com clipes A/V linkados e trims independentes → L-cuts e J-cuts nativos na timeline do app. |
| Capacidades | Operações pontuais (insert/move/delete/trim/split, ripple, overwrite), rough cut por comando, cobertura B-roll automática com J-cuts, análise crítica do corte, efeitos compatíveis com MLT (fades, mixes, volume, velocidade). |

### Sobre "IAs cineastas"

Não existe LLM especialista em cinema que valha a pena como motor do agente — os
fine-tunes de storytelling disponíveis são fracos em tool-calling. A expertise
cinematográfica virá da **camada de prompt + tools + validadores** que construiremos
(vocabulário NLE, regras de cobertura, gramática de J/L-cuts, conhecimento MLT). O
modelo base precisa ser forte em *agência*; a seleção curada cobre isso:

| Modelo (OpenRouter) | Perfil |
|---|---|
| `anthropic/claude-sonnet-4.5` | Mais confiável em tool-calling e raciocínio de edição. |
| `moonshotai/kimi-k2` | Excelente agentic + escrita criativa, custo baixo. |
| `z-ai/glm-4.6` | Forte em loops de ferramentas, barato. |
| `minimax/minimax-m2` | Focado em agentes, muito barato. |
| `deepseek/deepseek-chat` | Já é o TEXT_MODEL do projeto; economia máxima. |
| `google/gemini-2.5-pro` / `-flash` | Contexto longo (corte inteiro + transcrições), bom narrador. |
| `openai/gpt-4o-mini` | Fallback barato com tools decentes. |

O dropdown do chat lê essa lista de `CONFIG.AGENT_MODELS` (curada no `.env`/config),
com `AGENT_MODEL` como padrão.

---

## Arquitetura

### Fluxo por mensagem

1. Frontend envia: mensagem + histórico + **snapshot serializado da timeline**
   (formato v2: pistas, clipes, playhead, seleção, fps) + projeto ativo.
2. Backend (`chat_agent.py`) roda o loop de tools contra uma **cópia-sombra** da
   timeline: tools de leitura respondem do snapshot/banco; tools de mutação são
   aplicadas na cópia e acumuladas numa lista de operações validadas (colisões,
   tipos de pista, ripple, limites de duração da fonte).
3. Resposta final: texto do assistente + `operations[]` classificadas por risco:
   - `direct`: aplicadas imediatamente no TIMELINE_STATE (empilhadas no undo);
   - `preview`: viram ghost clips na pista de IA aguardando aceite.
4. Cards de mídia citada continuam funcionando como hoje (links video_id/photo_id).

### Tools do agente (backend)

**Leitura**
- `get_timeline_state()` — serialização rica reaproveitando `TimelineAIService.build_timeline_context` (falas reais, descrições visuais, lacunas de cobertura).
- `search_media(query, media_type?)` — busca híbrida do RAG.
- `get_transcript(video_id, start?, end?)` — texto exato com timestamps.
- `analyze_coverage()` — trechos de fala sem B-roll por cima.
- `consult_manual(query)` — busca no manual do programa (ver Fase 4).

**Mutação (validadas na cópia-sombra)**
- `insert_clip(track, video_id, in_s, out_s, at_s, mode=insert|overwrite, alternatives[])`
- `move_clip(clip_id, to_track, to_s)` / `delete_clip(clip_id)`
- `trim_clip(clip_id, edge, delta_s)` / `split_clip(clip_id, at_s)`
- `set_av_offset(clip_id, audio_lead_s)` — J/L-cut no par A/V linkado
- `add_effect(clip_id, effect, params)` — restrito ao catálogo MLT (fade in/out vídeo e áudio, volume, velocidade, mix same-track)
- `propose_bulk_edit(operations[], rationale)` — força classificação `preview`

### Modelo de dados

- Clipe ganha: `alternatives[] {video_id, in_s, out_s, ideal_duration_s, reason}`,
  `av_offset_s`, `effects[]`, `origin: user|ai`.
- Timeline v2 ganha pistas `kind: "audio"` de fato usadas; clipes A/V linkados por
  `link_id` (trims independentes, mover em conjunto por padrão).

---

## Fases de implementação

### Fase 0 — Fundamentos da timeline (pré-requisito de tudo)
1. **Undo/redo** em `timelineState.js` (pilha de snapshots ou command pattern) —
   exigência da autonomia híbrida.
2. **Pistas de áudio reais**: modelo A/V linkado, alturas/renderização em
   `timelineRenderer.js`, interação (mover par, trims independentes, destacar áudio)
   em `timelineInteraction.js`, mixagem no player (`player.js`) para reproduzir áudio
   de clipe diferente do vídeo visível (L/J-cut audível no preview).
3. Persistência do novo formato em `POST /api/timeline` (retro-compatível com v2).

### Fase 1 — Chat-agente com tools
1. `src/services/chat_agent.py`: loop OpenRouter function-calling, cópia-sombra,
   validadores, classificação de risco, orçamento de passos (máx. ~8 tool calls).
2. Rota `POST /api/project/{id}/chat` passa a aceitar snapshot da timeline e devolver
   `operations[]` (mantém compat com modo RAG antigo se snapshot ausente).
3. `chat.js`: envio do snapshot, aplicação de ops `direct` (com undo), envio de ops
   `preview` para a ghost track, indicador de "o agente está editando…" por tool call.
4. Dropdown de modelo no painel do chat + `AGENT_MODEL`/`AGENT_MODELS` em `config.py`.
5. System prompt do agente: vocabulário NLE multipista (insert vs overwrite, ripple da
   pista magnética, J/L-cuts, cobertura), regras de segurança e formato das tools.

### Fase 2 — Carrossel de alternativas
1. `insert_clip` do agente sempre tenta preencher 2–4 `alternatives` (candidatos da
   mesma busca semântica, com `reason` curto).
2. UI: hover em clipe `origin: ai` abre popup carrossel (thumb, razão, duração ideal);
   clique = troca slot fixo; botão "usar duração sugerida" = troca com ripple.
3. Troca registrada no undo; alternativas preservadas após troca (pode voltar).

### Fase 3 — Exportador MLT / .kdenlive (Kdenlive 24/25)
1. `src/export/mlt_kdenlive.py`: geração direta do XML MLT (documento v1.1):
   producers (caminhos originais), pares de playlists por pista (padrão Kdenlive),
   tractor com pistas de áudio e vídeo, `kdenlive:track.name`, guias/marcadores
   (exportar temas como guias!), mixes same-track, transições luma, efeitos de fade
   (`fadein/fadeout/volume`) e velocidade (`timewarp`), clipes A/V separados
   honrando `av_offset_s` e trims independentes.
2. Rota de export aceita `kdenlive`; botão no painel de export.
3. Validação: abrir no Kdenlive 25.x real e conferir pistas, cortes, L-cuts, fades.
4. Módulo de conhecimento MLT no system prompt do agente (o que é exportável, com
   que parâmetros) — o agente nunca promete efeito que o exportador não suporta.

### Fase 4 — Capacidades de alto nível + manual + RAG
1. **Rough cut por comando**: pipeline agentic — tema → segmentos → ordenação
   narrativa → inserção nas pistas com alternativas → resumo textual do racional.
2. **Cobertura B-roll automática**: `analyze_coverage` + inserções com J-cut padrão
   (áudio da entrevista contínuo, b-roll entrando ~0.5–1s antes do corte de vídeo).
3. **Análise crítica**: personas de editor (ritmo, repetição, buracos narrativos,
   duração por tema) lendo o contexto real — via conversa, sem endpoint separado.
4. **Manual do programa**: consolidar `USER_MANUAL.md` + funcionalidades atuais em
   chunks indexados no Qdrant (coleção `app_manual`), tool `consult_manual`.
5. **RAG aprimorado**: reformulação de query pelo agente (múltiplas buscas),
   deduplicação/rerank dos hits, serialização mais rica dos resultados (tema, rostos,
   speaker) — o formato de contexto do `timeline_ai.py` vira o padrão.

## Ordem e dependências

Fase 0 → Fase 1 → Fase 2 (depende do modelo de alternativas da F1) → Fase 3
(precisa de A/V linkado da F0) → Fase 4 (usa tudo). Fases 3 e 2 podem inverter se a
prioridade for exportar cedo para o Kdenlive.

## Riscos conhecidos

- **Pistas de áudio reais** é a maior refatoração (renderer, interação, player,
  persistência). Mitigação: manter clipes A/V linkados movendo em conjunto por
  padrão; só o trim/offset é independente no MVP.
- **Formato .kdenlive** é sensível a versão — validar contra Kdenlive 25.x real logo
  no início da Fase 3 com um arquivo mínimo gerado à mão.
- **Modelos baratos** podem falhar em loops longos — o validador da cópia-sombra
  rejeita ops inválidas e devolve o erro ao modelo (retry barato), e rough cuts
  recomendam modelo forte no dropdown.
