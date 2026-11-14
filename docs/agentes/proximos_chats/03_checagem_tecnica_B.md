# Chat 03: checagem técnica de take (B)

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> Faça depois do chat 01 (ordem das análises).

---

Vamos implementar a checagem técnica dos takes da obra no CapIAu Talho: achar equipamento de set
entrando no quadro (boom, microfone, tripé, refletor, reflexo da equipe) para o montador revisar.
Leia antes `docs/propostas/PROPOSTA_BUSCA_OBJETOS.md` (rota B) e `docs/planos/ORDEM_DAS_ANALISES.md` (item 7 da ordem
recomendada). Confira no código o que eles afirmam; linhas podem ter andado.

## O que já existe (conferido em 05/10/2026)

- `src/vision/detectores.py`: interface `detectar(motor, imagem, classes_pt, min_conf, project_id)`
  com Gemini, YOLO-World, OWLv2, Grounding DINO, Florence-2; caixas canônicas 0-1000.
- `src/services/pipeline.py`: `_detectar_objetos_frame` (~239) grava em `detected_object` em todo
  keyframe de todo vídeo quando `object.detector_engine` != none (~833-866), **sem olhar categoria**.
  Isso tem de mudar.
- `detected_object` (`src/db/schema.py` ~445): ninguém lê. Tem `realm`, `status`
  (auto/confirmed/rejected), `crop_path`, `raw_payload`.
- Medido: com lista fechada e sem "nenhum", os detectores forçam tudo numa classe (lente virou
  claquete, arara virou tripé). Florence-2 marca toda classe pedida e não dá confiança: não serve
  para B. Gemini foi o melhor no olho.

## Decisões já tomadas por mim

- B roda na ingestão **quando pedida**: pelo chat de onboarding ou por botão manual. Nunca sozinha.
- B só em vídeo com `category = 'obra'` e categoria firme (corrigida por mim ou acima do limiar).
- B é **independente**: recebe só os quadros e a lista de classes, nunca a descrição da visão. A
  visão pode servir só para **descartar** um alarme (ex.: "é making of"), nunca para confirmar.
- Resultado é **suspeita para revisar**, com quadro e caixa; nunca "erro".

## O que fazer (um commit por etapa, cada uma testável)

1. **Isolamento**: coluna `finalidade` em `detected_object` ('tecnica' | 'continuidade' | 'consulta')
   e `vocabulario` (lista de classes usada). Migração junto da existente (`schema.py` ~521). O DELETE
   da reanálise (`pipeline.py` ~838) passa a filtrar por finalidade. **Pergunte-me antes**: coluna
   (recomendado) ou tabela `take_check` separada.
2. **Tirar a detecção do laço geral** de `analyze_video_vision`: B vira uma função própria (nova,
   ex. `src/services/checagem_set.py`) que roda sobre os keyframes de um vídeo de obra.
3. **Classe "nenhum" e dupla verificação**: lista de equipamento com classe de fuga; caixa só vale
   se passar no limiar e, para os detectores locais, numa segunda checagem (ex.: CLIP do recorte
   contra "equipamento de filmagem" vs. "cena"). Meça com `scripts/detectores_comparar.py` em quadros
   de obra e de não obra; me mostre a folha antes de fechar o padrão.
4. **Padrão do detector de B**: Gemini (pago, preciso) ou OWLv2 (grátis, mais lento). Pergunte-me,
   mostrando custo por hora de obra e tempo por quadro medidos.
5. **Gatilho manual**: rota nova (ex. `POST /api/project/{id}/checagem-tecnica`, com `dry_run` que
   mostra quantos vídeos e custo, como `launch_transcription_worker` em `src/api/routes/media.py`)
   e botão discreto na interface. Rodar em processo separado, como os workers existentes.
6. **Gatilho pelo chat de onboarding**: opção para pedir a checagem. O arquivo
   `src/services/onboarding_agent.py` é da outra sessão: mexa só no mínimo (um chip/intenção) e me
   avise exatamente o que mudou.
7. **Tela de revisão**: lista de suspeitas por take, com recorte (aqui volta o `object.auto_crop`,
   removido no chat 02: recortes em `data/cache/crops/objects`), confirmar/rejeitar
   (`status`), abrir o take no instante. Painel que **empurra**, nunca sobrepõe; nada abre sozinho.
   Siga `docs/agentes/HANDOFF_DESIGN_UI.md` (texto 9–12 px, botões 20–28 px, `var(--fs-N)`, `var(--sp-N)`,
   `--accent`).

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev` e `docs/agentes/HANDOFF_DESIGN_UI.md`.
- Outra sessão mexe na interface (`index.html`, `main.js`, `workspaceManager.js`, `styles.css`,
  `library.js`, `welcomeHub.js`, `onboarding_agent.py`). Commit só dos seus trechos (índice montado
  a partir do HEAD), direto na main, sem coautoria, sem push.
- Modelos não baixam sozinhos: use `src/services/modelos_locais.py` (`exigir`). Download grande:
  pergunte com o tamanho.
- Testes que gravam no banco real devolvem os valores; prefira SQLite em memória.
- Scripts de edição em arquivo, com `PYTHONUTF8=1`. Servidor de teste `capiau-server-venv` (8022).
- Português, direto. Verifique antes de afirmar.

## Pronto quando

B roda só quando pedido, só em obra, grava com `finalidade='tecnica'`, aparece numa tela de revisão;
reanálise de A não apaga B; folha de comparação em quadros de obra e não obra mostrada e aprovada.
