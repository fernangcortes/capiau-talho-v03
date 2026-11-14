# Prompt do próximo chat: triagem, áudio e reanálise

> Escrito em 06/10/2026, no fim da sessão que fez a ordem das análises e a taxonomia nova.
> Cole o bloco abaixo no chat novo.

---

Vamos continuar a reorganização das análises do CapIAu Talho. Leia antes, nesta ordem, e confira
no código cada afirmação antes de mexer (as linhas podem ter andado; se algo não bater, me avise):

1. `docs/planos/ORDEM_DAS_ANALISES.md` (seções 6 e 7: o que mudou e achados pendentes)
2. `docs/planos/REVISAO_CATEGORIAS.md` (taxonomia em dois eixos, decisões, seção 13: o que está feito)
3. `docs/planos/PLANO_AUDIO_CATEGORIAS.md` (categorias de áudio aprovadas, calibração pendente)
4. `docs/agentes/HANDOFF_DESIGN_UI.md` se for mexer em interface

## Estado em 06/10/2026 (tudo na main, sem push)

- Bugs de rosto corrigidos (nome não some na reanálise; rosto do analyze_video_all roda).
- Ordem: ASR antes da Laya e da triagem; piso de esforço quando a triagem é incerta (confiança
  vazia, baixa ou Laya discordando); correção humana marca "análise desatualizada"; um resumo só
  (fala + imagem); descrição de cada keyframe no SQLite (`video_keyframe`).
- Taxonomia B: `cena, bastidor, depoimento, convivio, evento, teste, documento, terceiros` + marca
  `fora_do_projeto`; regras de desempate; `categorias_secundarias` (misto); `project.objetivo`
  (projeto 2 já preenchido); triagem com um quadro por plano; categoria fora do prompt da visão;
  o resumo com imagem julga a categoria (`categoria_resumo`) e a divergência vai para a fila.
- Fotos: rajada com limiar 0,80 e teto de 10 por grupo.
- Welcome Hub pergunta o objetivo na criação. Biblioteca com os rótulos novos.
- Bancada `scripts/visao_calibrar.py` pronta (dry-run por padrão).
- Qdrant de imagens foi consertado (80 de 81 vetores; corrompido guardado em `data/`).

## Próximos passos, nesta ordem

1. **Camada 1 do áudio** (`docs/planos/PLANO_AUDIO_CATEGORIAS.md`, seção 3): coluna `natureza`, detectar
   áudio (sem faixa de vídeo ou imagem parada) na ingestão e na análise, e tirar esse material da
   visão. Teste com fixtures geradas por ffmpeg.
2. **Camada 2 do áudio, genérica**: classificador AudioSet local (YAMNet ou PANNs, o menor que
   servir), mapa para `depoimento, locucao, trilha, efeito, ambiente, room_tone`, heurísticas de
   RMS/duração/nome. Motor falso nos testes. Marcar no plano o que ficou sem calibrar (faltam
   arquivos de efeito, room tone, ambiente e locução).
3. **Rodada só de triagem** nos ~526 vídeos sem categoria (rota ou script, sob pedido; mostrar
   custo antes). Depois eu reviso a fila.
4. **Calibração dos números por categoria** com `scripts/visao_calibrar.py` numa amostra que eu
   escolho depois da triagem.
5. **Reanálise completa** (lote de visão para b-roll; por vídeo para depoimentos), com o custo
   por categoria mostrado antes.

## Pendências para decidir comigo

- `src/api/server.py:32` chama `init_db()` no import: os testes que importam o servidor migram o
  banco real. Corrigir?
- `face.embedding` não está no `SCHEMA_SQL` nem em migração (banco novo quebra a detecção de rosto).
- `get_video_vision_frames` do Qdrant lê no máximo 100 pontos por vídeo.
- Campo de objetivo nas configurações do projeto (hoje só na criação, pelo Hub).

## Regras deste repositório

- Outra sessão trabalha na interface (`index.html`, `main.js`, `workspaceManager.js`,
  `styles.css`, `library.js`, `welcomeHub.js`, `src/export/video_render`). Commit só dos seus
  trechos (índice montado a partir do HEAD quando o arquivo tem trabalho alheio), direto na main,
  **sem linha de coautoria**, **sem push**.
- Testes de pipeline: SQLite em memória (`tests/test_ordem_analises.py`, fixture `banco`).
- Scripts de edição: grave em arquivo e rode com `PYTHONUTF8=1` (heredoc do shell come barras).
  Preserve o fim de linha do arquivo (o `sed -i` tira o CRLF).
- Português, direto. Verifique antes de afirmar.
