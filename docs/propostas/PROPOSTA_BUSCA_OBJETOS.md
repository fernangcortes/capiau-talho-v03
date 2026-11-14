# Proposta: busca por objeto (A, B, C, D) sem conflito

Status: proposta, nada implementado. Tudo marcado como **(novo)** não existe hoje.

## 1. Como a busca funciona hoje

- Toda frase vira `RAGService.search_hybrid` (`src/services/rag.py:185`): rostos e falantes no SQLite, depois Qdrant de texto (`rag.py:319`) e CLIP (`rag.py:336`), fundidos. Não há classificação de intenção.
- O chat chama `search_hybrid` com a mensagem crua antes de qualquer ferramenta (`chat_agent.py:1842`) e tem a ferramenta `search_media(query, media_type)` (`chat_agent.py:639`, executada em `:1958`). Não existe ferramenta de objetos.
- A rota `/api/search/visual` (`narrative.py:176`) só aceita facetas de enquadramento/categoria/movimento/paleta, não objeto.
- A visão gera `objetos` em texto livre (`prompt_registry.py:44`), que vai só no payload do Qdrant (`semantic.py:251`). O que é embedado é descrição + tags (`semantic.py:231`).
- `detected_object` (`schema.py:445`) é escrita por `_detectar_objetos_frame` (`pipeline.py:239`) com a lista fixa `object.classes_filter` (`settings_registry.py:264`), em todo vídeo, sem olhar `video.category`. Nada em `src/api` a lê.
- O player tem `renderGroundingBoxes` com click-to-search (`player.js:1901`), mas só é chamado com rostos (`player.js:1893`), e o evento `groundingSearchRequested` (`:1976`) não tem nenhum ouvinte no código. Hoje o clique só preenche a caixa de busca (`:1985`).
- Já existem dois ganchos de isolamento: `detected_object.realm` ('production'|'story', `schema.py:455`) e `video.category` com valor 'obra' (`schema.py:48`, `analysis_policy.py:58`).

## 2. Roteador de intenção (novo)

Arquivo novo `src/search/intent_router.py`, função `rotear(frase, contexto) -> {rota, objeto, escopo}`. Duas camadas:

1. **Regras (grátis, primeiro)**: léxico em português para B (boom, microfone, tripé, reflexo, equipe, "aparecendo", "entrando no quadro", "erro de take", "sujeira") e para C (nome de cena/personagem + "aparece", "continuidade", "adereço", "cadê"). Contexto também decide: player aberto sobre take de obra e clique em caixa = D.
2. **LLM barato**: só se as regras não decidirem. Laya/Jev já existe como cliente de decisão barata (`system1_service.py:206`); a pergunta nova (`perguntas_roteador`, nova) segue o formato de `perguntas_triagem` (`:77`). Sem chave ou fora do ar, cai em A.

**Regra de ouro: na dúvida, A.** B e C só ganham com sinal explícito. Assim a análise técnica nunca sequestra uma busca comum.

| Frase | Rota |
|---|---|
| "planos com carro", "garrafa verde", "mãos mexendo em papel" | A |
| "takes com boom aparecendo", "tripé no quadro", "reflexo da equipe" | B |
| "o revólver da cena 12 aparece em algum take?" | C |
| clique na caixa de um objeto no player | D (vira A ou C conforme o objeto) |
| "carro" com o player parado num take de obra | A (contexto não muda a rota) |

D não é rota própria: é o mesmo roteador recebendo o rótulo da caixa. Se a caixa veio de uma detecção `realm='production'`/finalidade B, o clique oferece "buscar planos com isso" (A), não "mais takes com equipamento".

Integração: `search_hybrid` ganha parâmetro `intent` (padrão A, comportamento atual intacto); o chat ganha ferramenta nova `buscar_objeto`; `/api/search/visual` ganha `?objeto=`.

## 3. Isolamento: cada análise com sua finalidade

Princípio: **A não lê nada de B/C, e B não escreve em nada que A lê.**

Mudanças exatas:

- **`detected_object.finalidade`** (nova coluna, `TEXT CHECK IN ('tecnica','continuidade','consulta')`, default `'tecnica'`), migração em `schema.py` junto da migração de `detected_object` (~`:521`). Mais `detected_object.vocabulario` (novo, texto: lista de classes usada, para auditoria).
  - `tecnica` = B. Roda só em vídeo com `category='obra'`, usa lista de equipamento **com classe "nenhum/outro"** (ver riscos) e `realm='production'`.
  - `continuidade` = C. Classes vêm de `scene.props_json` (`schema.py:310`) da cena do take, `realm='story'`.
  - `consulta` = A/D. Resultado efêmero, não vira linha permanente (ou vira com TTL), `realm` herdado.
- **A nunca consulta `detected_object` como fonte de verdade.** A usa: CLIP (`image_semantic.search_text`, `:206`) + texto do Qdrant (`semantic.py:231`) + verificação por detector de vocabulário aberto **na hora**, só sobre os top-N candidatos (seção 5). Isso troca a lista fixa por o que a pessoa digitou.
- Resultado de A carrega `match_source="objeto_consulta"`; de B/C, `match_source="tecnica"`/`"continuidade"`. `rag.py:461-471` já usa `match_source` para a explicação, então o ponto de extensão existe.
- `ImageSearch.search_text` ganha filtro `finalidade` (novo) só se a camada de payload for indexada; fora isso não mexe no Qdrant.
- Alternativa mais limpa se o usuário preferir: tabela separada `take_check` (video_id, timestamp, rotulo, caixa, severidade, status) para B, deixando `detected_object` só para A/D/C. Recomendo a coluna: reaproveita índices (`schema.py:479-485`), `status` de curadoria e o DELETE de reanálise que já protege curadoria humana (`pipeline.py:836`).

Importante: o DELETE em `pipeline.py:836` apaga só `status='auto'`; precisa passar a filtrar por `finalidade` para não apagar B ao reanalisar A.

## 4. Sugestões proativas

Regra do projeto: nada abre sozinho; sugestão discreta, o usuário escolhe abrir. Proposta: uma **linha de dica** (chip pequeno) no cabeçalho do player e no painel da cena, nunca modal, nunca toast.

- Take de obra aberto, com checagem B já feita: chip "2 takes com boom no quadro (ver)". Clicar abre a lista num painel que **empurra**, não sobrepõe.
- Cena do roteiro aberta: chip "adereço 'revólver' não visto em nenhum take (buscar)". Fonte: `props_json` x resultado C.
- Resultado de A vazio: sugestão "tentar com outro termo / procurar nos takes".
- Endpoint novo `GET /api/sugestoes?video_id=|scene_id=` devolve só contagens e rótulos; o front só renderiza o chip. Dispensável por vídeo (fica no `localStorage`, por conveniência, não por estado).
- Sugestão B nunca aparece no meio de uma busca A em andamento.

## 5. Custo: ingestão x consulta

| Etapa | Quando | Modelo | Custo |
|---|---|---|---|
| CLIP por keyframe | ingestão (já existe) | CLIP local | já pago |
| Descrição/tags | ingestão (já existe) | LLM visão | já pago |
| **A: verificação do objeto** | consulta | CLIP já filtra; OWLv2/Grounding DINO (`detectores.py:182/:206`) só nos top ~30 frames | local CPU, segundos, só quando a pessoa pede |
| **B: equipamento no quadro** | ingestão, só `category='obra'` | Gemini (`detectores.py:278`) por keyframe, ou OWLv2 local | custo só nos takes da obra; o resto do acervo não paga |
| **C: adereço da cena** | sob demanda por cena | detector de vocabulário aberto com classes de `props_json` | só ao abrir a cena ou pedir |
| Roteador | consulta | regras, depois Laya | quase zero |

Hoje o detector roda em todo keyframe de todo vídeo se `object.detector_engine` estiver ligado (`pipeline.py:863`); a mudança corta isso a obra (B) e leva o resto para sob demanda.

## 6. Plano em etapas (cada uma testável)

1. **Migração + isolamento**: coluna `finalidade`/`vocabulario` em `schema.py`; `pipeline.py:836` e `:264-275` passam a gravar `finalidade='tecnica'`. Teste: reanalisar não apaga linhas de outra finalidade.
2. **B só em obra**: `pipeline.py:863` condicionado a `category=='obra'`; classe "nenhum" e remoção da lista fixa de `object.classes_filter` como universal. Teste: vídeo 'depoimento' não grava caixas.
3. **Roteador por regras**: `src/search/intent_router.py` + testes em `tests/` com a tabela da seção 2.
4. **A por vocabulário aberto na consulta**: função nova em `detectores.py` (verificar candidatos CLIP) + `search_hybrid(intent='A')`. Teste: "garrafa verde" não consulta `detected_object`.
5. **Ferramenta do chat** `buscar_objeto` em `chat_agent.py:627` + roteamento em `:1958`.
6. **D no player**: ouvinte de `groundingSearchRequested` (`player.js:1976`), caixas de `detected_object` num endpoint novo de leitura em `src/api/routes`.
7. **C**: cruzar `scene.props_json` com detecção; endpoint de sugestões e chips (seção 4).
8. **Roteador LLM** (Laya) para frases ambíguas.

## 7. Riscos e decisões do usuário

- **Alucinação por lista fechada** (medido: lente vira claquete, arara vira tripé). Mitigar com classe "nenhum", limiar por classe e dupla verificação (CLIP + detector) antes de afirmar. B deve sempre dizer "possível" e levar ao frame, nunca decretar erro.
- Falso positivo de B em take bom gera ruído; sugestão só acima de limiar e curável (`status='rejected'`, `schema.py:470`).
- CPU: OWLv2/DINO por consulta pode demorar; limitar a N frames e mostrar progresso.
- Gemini no B custa por keyframe de obra.

Decisões:
1. Coluna `finalidade` em `detected_object` (recomendado) ou tabela `take_check` separada?
2. B roda automático na ingestão da obra, ou só quando o usuário pede "checar takes"?
3. Gemini (preciso, pago) ou OWLv2 local (grátis, mais lento) como padrão de B?
4. Chips de sugestão: só no player, ou também na biblioteca?
5. Aceita "na dúvida, A" mesmo que às vezes mande uma pergunta de B para a busca comum?
