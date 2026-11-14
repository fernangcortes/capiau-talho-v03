# Chat 04: busca por objeto (A), roteador de intenção e clique no player (D)

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> Faça depois do chat 03 (precisa da coluna `finalidade`).

---

Quero achar planos por objeto no CapIAu Talho ("planos com carro", "garrafa verde") sem lista fixa
de classes, e que o programa entenda o que estou procurando e sugira buscas sem misturar com a
checagem técnica. Leia antes `docs/propostas/PROPOSTA_BUSCA_OBJETOS.md` (seções 2, 3, 4 e 6) e confira no
código cada afirmação; linhas podem ter andado.

## O que já existe (conferido em 05/10/2026)

- Toda busca vira `RAGService.search_hybrid` (`src/services/rag.py:185`), sem classificar intenção.
  O chat chama com a mensagem crua e tem a ferramenta `search_media` (`src/services/chat_agent.py`
  ~639, executada ~1958).
- CLIP texto→imagem: `ImageSearch.search_text` (`src/search/image_semantic.py:206`), facetas só de
  enquadramento/categoria/movimento/paleta.
- A visão já lista "objetos" em texto livre por keyframe (`src/nlp/prompt_registry.py:44`), guardados
  só no payload do Qdrant (`src/search/semantic.py` ~251); não entram no vetor (~231) e ninguém lê.
- Player: `renderGroundingBoxes` (`src/ui/js/player.js:1901`) desenha caixas e tem clique, mas só
  com rostos (~1893); o evento `groundingSearchRequested` (~1976) não tem ouvinte.
- Detectores de vocabulário aberto prontos em `src/vision/detectores.py` (OWLv2 ~4 s/quadro,
  Grounding DINO ~8 s/quadro na CPU).

## O que fazer (um commit por etapa)

1. **A na hora da consulta**: função nova que pega os top-N quadros do CLIP para o texto digitado e
   confirma com OWLv2 ou Grounding DINO usando **o próprio texto** como classe (com a tradução para
   inglês de `TRADUCAO_CLASSES` ou de um LLM barato). Devolve quadro, caixa e confiança; resultado
   com `match_source="objeto_consulta"` (`rag.py` já usa `match_source` na explicação, ~461-471).
   **A nunca lê `detected_object` de finalidade 'tecnica'.** Teste: "garrafa verde" não consulta B.
   Meça tempo por consulta com N=10, 20, 30 e me mostre antes de fixar N.
2. **Roteador de intenção** (novo, `src/search/intent_router.py`): regras em português primeiro
   (B: boom, tripé, "no quadro", reflexo, equipe; C: cena N, adereço, continuidade, "aparece"); na
   dúvida, **A**. Tabela de frases → rota como teste. Só depois, se eu pedir, um LLM barato para as
   ambíguas (a Laya foi mal na triagem; meça antes de usar aqui).
3. **Chat**: ferramenta nova `buscar_objeto` no agente; `search_hybrid` ganha `intent` (padrão A,
   comportamento atual intacto). `chat_agent.py` não é da outra sessão hoje, mas confira o
   `git status` antes.
4. **D no player**: ouvinte de `groundingSearchRequested`; caixas de objetos vindas de rota nova de
   leitura (só caixas que eu confirmei ou de consulta recente). O clique cai no mesmo roteador.
5. **Sugestões discretas**: chip pequeno (nunca modal ou toast), que eu escolho abrir; painel que
   empurra. Pergunte-me: só no player ou também na biblioteca.
6. Interface segue `docs/agentes/HANDOFF_DESIGN_UI.md` (9–12 px, botões 20–28 px, `var(--fs-N)`,
   `var(--sp-N)`, `--accent`, nada abre sozinho).

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev` e `docs/agentes/HANDOFF_DESIGN_UI.md`.
- Outra sessão mexe na interface (`index.html`, `main.js`, `workspaceManager.js`, `styles.css`,
  `library.js`, `welcomeHub.js`, `player.js` às vezes). Commit só dos seus trechos (índice montado a
  partir do HEAD), direto na main, sem coautoria, sem push.
- Modelos não baixam sozinhos (`src/services/modelos_locais.py`, `exigir`).
- O Qdrant local já apareceu corrompido ("database disk image is malformed"); se a busca vetorial
  falhar, me avise antes de tentar consertar.
- Scripts de edição em arquivo, com `PYTHONUTF8=1`. Servidor de teste `capiau-server-venv` (8022).
- Português, direto. Verifique antes de afirmar.

## Pronto quando

"planos com X" acha e marca a caixa sem lista fixa; o roteador manda B e C para as rotas certas e o
resto para A; clique numa caixa no player busca; nenhuma busca A usa resultado de B.
