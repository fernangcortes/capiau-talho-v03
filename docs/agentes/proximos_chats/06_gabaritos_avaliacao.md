# Chat 06: gabaritos humanos e avaliação honesta dos modelos

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> Pode rodar em paralelo com os chats 01 e 02.

---

As comparações de modelos do CapIAu Talho feitas em 05/10/2026 têm viés: a "resposta certa" era
outro modelo, não eu. Quero gabaritos marcados por mim e medições contra eles, para escolher padrões
com base em acerto real. Confira tudo no código antes de afirmar.

## O que já existe

- `scripts/system1_avaliar.py`: Laya e Jev contra a categoria atual do vídeo (em geral, da triagem
  por visão) ou contra `triage_feedback` (correção humana). Decisões em `system1_decisao`.
- `scripts/asr_comparar.py`: motores de transcrição nos mesmos clipes; WER contra o primeiro motor.
- `scripts/detectores_comparar.py`: folha de contato HTML com caixas lado a lado; "concordância"
  entre detectores, não acerto.
- Fila de revisão de triagem: `src/api/routes/media.py` (`triage_review_queue`, ~156) grava em
  `triage_feedback`.

## O que fazer (um commit por etapa)

1. **Triagem**: página de marcação rápida (Artifact ou tela local, você propõe) com ~50 vídeos
   **variados** (não só um projeto, não só "processo"): mostra 4 quadros e o começo da fala; eu
   clico a categoria. Grava em `triage_feedback`. Depois, `system1_avaliar.py` passa a medir contra
   o humano e mostra também o acerto da triagem por visão e do chute pela classe mais comum.
2. **Laya com mais contexto**: hoje ela recebe nome, pasta, duração e começo da fala
   (`estado_triagem` em `src/services/system1_service.py`). Teste dar a transcrição maior e a
   descrição do primeiro quadro; meça contra o gabarito. Não mude o modo (sombra).
3. **Treino da Laya**: dados de `system1_decisao` + `triage_feedback`; o fine-tuning do modelo
   (convaiinnovations/laya) tem notebook para Kaggle 2×T4. Prepare o dataset e me diga o tamanho
   mínimo que faz sentido; não rode treino sem eu pedir.
4. **Jev + Laya em dupla** (pedido meu em 05/10). Medido em 23 vídeos, contra a triagem por visão:
   Jev 13/23, Laya 2/23; quando os dois concordaram (2 vezes) acertaram as 2; Jev com confiança
   >= 0,7 acertou 7/9. O Jev custa ~US$ 0,000015 por vídeo. Então:
   - ligar `triage.system1_compare_jev` por padrão (modo sombra continua: só registra);
   - regra de decisão nova (desligada até medir contra o gabarito): pular a triagem por visão só
     quando Jev e Laya **concordam** e os dois passam do limiar; se discordarem, a visão decide;
     se só o Jev estiver seguro, registrar como "Jev seguro" para medir;
   - medir contra o gabarito do item 1: acerto e cobertura (quantos vídeos a dupla resolve sozinha)
     de cada regra (Jev sozinho, Laya sozinha, dupla concordando, Jev com confiança alta) e me
     mostrar antes de ligar qualquer modo que decida;
   - a Laya só melhora a dupla depois do treino (item 3): sem treino, a concordância é rara.
5. **Transcrição**: eu corrijo 3 minutos de transcrição (2 a 3 clipes, um limpo, um barulhento,
   um com fala sobreposta) a partir da saída da AssemblyAI; `asr_comparar.py` ganha `--gabarito`
   e mede WER contra mim, para AssemblyAI, Deepgram, Whisper (turbo e small) e Canary. Diarização:
   eu marco quem fala; meça DER simples para AssemblyAI, Nemotron e pyannote.
6. **Objetos**: página de marcação de ~30 quadros variados (bastidor, obra, externa, carro, casa),
   onde eu desenho caixas ou marco "tem/não tem" para uma lista **aberta**. Meça precisão e
   revocação por detector, com e sem classe "nenhum". Isso alimenta a escolha do padrão no chat 03.
7. Relatório final em `docs/` com números contra o gabarito e recomendação de padrão por tarefa.

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev` e `docs/agentes/HANDOFF_DESIGN_UI.md`.
- Outra sessão mexe na interface. Commit só dos seus trechos (índice a partir do HEAD), direto na
  main, sem coautoria, sem push.
- Chamadas pagas (AssemblyAI, Deepgram, Jev, Gemini, OpenRouter): diga o custo estimado antes de
  rodar lotes. Downloads grandes: pergunte com o tamanho.
- Testes que gravam no banco real devolvem os valores.
- Scripts de edição em arquivo, com `PYTHONUTF8=1`. Português, direto. Verifique antes de afirmar.

## Pronto quando

Existem gabaritos meus para triagem, transcrição/diarização e objetos, e um relatório com o acerto de
cada modelo contra eles.
