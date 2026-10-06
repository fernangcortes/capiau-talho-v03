# Chat 01: correções e ordem das análises

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.

---

Vamos corrigir dois bugs confirmados e ajustar a ordem das análises da ingestão do CapIAu Talho, para
que cada análise use o contexto da anterior sem criar viés. Leia antes `docs/ORDEM_DAS_ANALISES.md`
(mapa de dependências, feito em 05/10/2026) e confira no código cada afirmação antes de mexer: as
linhas podem ter andado. Se algo não for como o documento diz, me avise em vez de seguir.

## Bugs confirmados (prioridade: protegem dado meu)

1. **Rostos perdem o nome na reanálise.** `src/vision/face_engine.py:199` (`process_video_frame_faces`)
   faz `DELETE FROM face WHERE video_id = ? AND timestamp = ?` (linha ~206) e regrava com
   `name = NULL`. Efeitos: (a) nomes que confirmei naquele instante podem sumir ao reanalisar;
   (b) logo depois, `analyze_video_vision` (`src/services/pipeline.py:704`) lê os nomes confirmados
   do mesmo instante para pôr no prompt de visão, e eles nunca chegam.
   - Antes de corrigir, **meça**: quantas faces com nome existem hoje (`SELECT count(*) FROM face
     WHERE name IS NOT NULL ...`) e se algum vídeo já reanalisado perdeu nomes. Me mostre.
   - Correção proposta: só apagar o que é automático (ver como `src/services/face_service.py` faz
     com `status`, ~linha 1100) e preservar nome/curadoria; casar a face nova com a antiga pela caixa
     (IoU) para herdar o nome. Teste: face nomeada sobrevive à reanálise e chega em
     `detected_people` do prompt de visão.
2. **`extract_frame` com argumentos trocados** em `pipeline.py:1691` (`analyze_video_all`):
   chama `extract_frame(filepath, sample_frame, sample_ts)`, mas a assinatura é
   `extract_frame(video_path, timestamp, output_path, ...)` (`src/media/ffmpeg.py:167`). O try/except
   engole o erro, então o rosto desse fluxo provavelmente nunca roda. Corrigir e testar com mock.

## Ordem das análises (depois dos bugs, um commit por item)

3. **Transcrição antes da triagem.** `triage_video` (`pipeline.py:143`) e `triage_system1` (`:279`)
   usam a transcrição "se existir", mas nada garante que exista. Em `analyze_video_vision`, antes da
   triagem (`if not category:` ~linha 724): se o vídeo tem áudio e não tem transcrição, transcrever
   primeiro **ou** registrar no log da tarefa que a triagem rodou sem fala. Pergunte-me qual dos dois
   antes de implementar (transcrever antes custa a nuvem por vídeo).
4. **Piso de esforço quando a triagem é incerta.** `src/services/analysis_policy.py:138`
   (`get_profile`): categorias `cotidiano`/`pessoal` dão só 2 quadros. Com confiança abaixo de
   `triage.min_confidence`, usar o perfil `completo`. Parâmetro novo de confiança; teste de política.
5. **Correção humana da categoria marca análise desatualizada.** Rota de correção em
   `src/api/routes/media.py` (~195-229, perto de `_record_triage_feedback`). Se o perfil de esforço
   mudar, marcar o vídeo como "análise desatualizada" (campo novo) e oferecer reanálise; subir o
   esforço reanalisa, descer não apaga nada. **Nada roda sozinho**: só marca e oferece.
6. **Resumos que se sobrescrevem e temas duas vezes.** `generate_video_summary` (`pipeline.py:1283`):
   o resumo de entrevista não recebe a categoria e o de imagens grava no mesmo campo. Confira e
   proponha: mesclar ou campos separados. Temas (`src/nlp/theme_engine.py`) rodam no fim do ASR e
   no fim da visão: rodar uma vez no fim do fluxo completo.
7. **Laya continua em sombra**, depois da transcrição. Não mude o modo.

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev` e `docs/HANDOFF_DESIGN_UI.md`.
- **Outra sessão trabalha no mesmo repo** (interface: `index.html`, `main.js`, `workspaceManager.js`,
  `styles.css`, `library.js`, `welcomeHub.js`). Não faça `git add` de arquivo inteiro que você não
  escreveu; commit só dos seus trechos (montar o índice a partir do HEAD), direto na main, **sem
  linha de coautoria**, **sem push**.
- Testes que gravam no banco real: guarde e devolva os valores (fixture `preserve_real_api_keys`
  em `tests/test_onboarding_agent.py`). Para testes de pipeline, prefira SQLite em memória com
  `SCHEMA_SQL` (exemplo em `tests/test_system1_motores.py`, fixture `banco_memoria`).
- Scripts de edição: grave em arquivo e rode com `PYTHONUTF8=1` (heredoc do shell come barras).
- Servidor de teste: `capiau-server-venv` do `.claude/launch.json` (porta 8022).
- Português, direto. Verifique antes de afirmar.

## Pronto quando

Os dois bugs corrigidos com teste; itens 3 a 6 decididos comigo e implementados, cada um com teste e
commit; `docs/ORDEM_DAS_ANALISES.md` atualizado com o que mudou.
