# Chat 08: planos-sequência — do teste ao Talho

> Cole tudo abaixo da linha num chat novo, com a pasta `C:\Users\FGC\dev\capiau\talho` aberta.
> Sessão de origem: 07/10/2026. Objetivo da próxima: **tirar o máximo do que foi feito aqui**.

---

Na sessão de 07/10/2026 testamos, fora do app, a ideia do NVIDIA VSS (trechos curtos + modelo de
visão com tempo marcado) em planos-sequência do Making of Monstro. O resultado ficou muito bom e
**tudo o que foi feito é para virar parte do Talho**: o formato do relatório, o detector de
candidatos a plano-sequência e a análise por trechos. Confira no código antes de afirmar.

## 1. O que existe (scripts, nada commitado ainda)

| Arquivo | O que faz |
|---|---|
| `scripts/plano_sequencia_medir.py` | Acha candidatos a plano-sequência: takes brutos de câmera (MVI_, 000xx.MTS, handcam) > 2 min; mede no proxy, a 1 quadro/s, **movimento** (phaseCorrelate entre quadros a 0,2 s, > 1 px em 192 px), **deriva** (histograma HSV a 10 s), saltos bruscos e fração escura. Nota = movimento × deriva × (1 − escuro). 112 takes medidos em ~25 min de CPU |
| `scripts/plano_sequencia_candidatos.py` + `.html` | Player para escolher clipes: vídeo, tira de 12 quadros clicável, medidas em barras, escolher/nota, JSON |
| `scripts/plano_sequencia_teste.py` | O teste: trechos de 8 s a cada 6 s, 4 quadros (640×360) por trecho → modelo de visão do Talho (`call_openrouter_vision_multi`, gasto real via `OBSERVADORES_DE_USO`). Pede escala início/fim, movimento (13 classes, inclui zoom, dolly, travelling, órbita, grua), descrição, assunto, nº de pessoas, local, `mudanca`, qualidade, confiança. Ao lado, o Talho de hoje: escala por CLIP (`ShotScaleClassifier`) e movimento por fluxo óptico (`classify_motion`). `--plano`, `--teto`, `--limite` |
| `scripts/plano_sequencia_teste_relatorio.py` + `.html` | Relatório: 4 faixas por vídeo na linha do tempo (escala visão / CLIP, movimento visão / fluxo) com cursor e clique para pular, trechos sugeridos, lista de trechos que acompanha o vídeo, revisão ✓/✗ com escala e movimento certos, filtros, JSON |
| `scripts/servir_relatorios.py` | Servidor de `data/` **com Range** (o `http.server` não deixa o vídeo pular). Entrada `relatorios-range` (porta 8771) em `.claude/launch.json` |

Resultados em `data/cache/plano_sequencia/` (fora do git): `medidas.json`, `candidatos.html`,
`teste_2026-10-07_1759.json` e `.html`. Abrir pelo servidor:
`http://127.0.0.1:8771/cache/plano_sequencia/teste_2026-10-07_1759.html`.

## 2. Números do teste (clipes 321, 388, 518, 306; escolhidos pelo Fernando)

- 133 trechos, todos responderam. **US$ 0,11** no total (~US$ 0,008 por minuto de vídeo), Gemini 2.5
  Flash. 11 min de processamento para 13 min de vídeo, sequencial.
- Escala igual ao CLIP em 23% dos trechos; movimento igual ao fluxo óptico em 11%.
- Modelo marcou `mudanca` em 59/133 → trechos sugeridos picados demais (21 a 33 por vídeo).
- **Defeito achado:** `classify_motion` diz "caminhando" em 92/133 trechos (o limiar de jitter/resíduo
  dispara com câmera na mão e gente se mexendo no quadro). Vale corrigir de qualquer jeito.
- Suspeita: o modelo diz "pan" demais; com 4 quadros a 2 s ele deduz o movimento, não vê.
- As descrições com tempo marcado ficaram boas.
- **A revisão humana ainda não foi feita.** Sem ela não dá para dizer quem acerta escala e movimento.

## 3. Ideias do Fernando para a próxima sessão (todas a explorar)

1. **Formato do relatório HTML como padrão** do Talho para revisar qualquer análise (triagem, trechos,
   rostos): vídeo + faixas na linha do tempo + lista sincronizada + revisão que vira gabarito.
2. **Detector de plano-sequência:** os 10 candidatos eram todos planos-sequência de fato. O critério
   (take bruto longo + movimento + deriva − escuro) serve para reconhecer plano-sequência na ingestão.
3. **Agrupar por tipo de trecho:** juntar trechos parecidos (escala, movimento, local, assunto) dentro do
   take e entre takes, para a biblioteca e a busca.
4. **Ligar com rostos:** cada trecho saber quem aparece (o Talho já tem `face`/`face_recognition`) → "os
   trechos em close da Mabel".
5. **Um trecho saber do outro:** passar ao modelo o resumo do trecho anterior (ou fazer duas passadas)
   para a descrição ter continuidade e o `mudanca` ficar menos sensível.
6. **Esquema do que acontece:** a IA lê todos os trechos de um take e escreve a estrutura (atos,
   momentos, quem entra e sai) com linha do tempo.
7. **Indicação visual na timeline do Talho:** símbolos e cores por escala/movimento/momento sobre o
   clipe, como as faixas do relatório.
8. **Começo e fim tremidos (08/10, nota na revisão do trecho 321 0:00):** analisar o começo e o fim de
   cada clipe para ver se a câmera está tremendo (ligando/desligando, ajeitando); mostrar isso na
   timeline e deixar o usuário **descartar com atalho** a ponta tremida.

9. **Tremida julgada localmente (321, 0:54):** "muito tremido" deveria sair de medida local, não do
   modelo; e saber **quando parou de tremer** (o 0:60 começa tremido e depois vira pan lento).
10. **Câmera que vai de um lado pro outro sem tremer (321, 1:24):** muito movimento lateral rápido;
    difícil para a análise. Discutir como tratar.
11. **Análise do clipe inteiro (321, 1:36):** uma passada final da IA sobre os trechos + som + transcrição
    decide o que vale para o take todo (todo na mão, todo no tripé, todo close) e os trechos só
    registram o que muda — sem repetir descrição e etiqueta.
12. **Direção do movimento (321, 2:06):** distinguir câmera que se move de ator que se move: direção do
    borrão, paralaxe (ombro desfocado em primeiro plano cruzando o quadro). Também **zoom × dolly**
    (321, 0:48: o modelo disse dolly out; era zoom in, tremida, tilt para baixo).
13. **Sinais na timeline — pediu um plano de implementação amplo, perguntando a ele (321, 1:00):**
    símbolos, cores, tooltips, atalhos de edição rápida, agrupamento, para achar fácil tipos de trecho:
    enquadramento, problemas (tremida, foco) e tudo o que a análise identificar. A marcação de
    qualidade (tremida, fora de foco) foi elogiada.

14. **Movimento × característica (08/10):** "na mão", "grua" etc. não são passo de sequência, valem o
    trecho inteiro. O relatório já separa: sequência de movimento (parado, pan, tilt, zoom, dolly,
    travelling, órbita, caminhando, chicote) + características liga/desliga — suporte (na mão, tripé,
    grua, estabilizador, drone) e imagem (tremida, fora de foco, escura, estourada, obstruída). **O
    prompt do próximo teste e o modelo de dados do Talho devem seguir essa divisão** (hoje o prompt
    pede `movimento` único com "na_mao"/"grua" misturados e `qualidade` única). Cada movimento da
    sequência tem **direção** (8 setas no quadro + frente/trás; JSON `movimento_direcoes`): pedir isso
    ao modelo também, e medir localmente (fluxo óptico dá a direção de pan/tilt de graça).

15. **Pan confundido com travelling e dolly (08/10):** o Fernando quase não usou travelling (e quando
    usou, foi na mão), mas o modelo deu travelling em 6 trechos (321: 4; 388: 1; 518: 1) e dolly in/out
    em 15. No 321 ele já trocou travelling → pan no 1:00 e 1:24 e dolly → zoom in/pan no 0:48 e 1:36;
    o 1:30 e o 1:54 estão marcados "certo" com travelling e provavelmente também são pan (reabrir para
    o gabarito não ficar contraditório). **Não corrigir todos** — uns 6 casos bastam para afirmar o
    padrão. Causa: com 4 quadros a 2 s o modelo não vê paralaxe (giro = tudo anda junto; deslocamento =
    o perto anda mais que o fundo) e chuta. Caminhos:
    - **Medir local:** separar giro de deslocamento no fluxo óptico (giro encaixa numa homografia única
      do quadro; deslocamento deixa resíduo por profundidade). Também resolve zoom × dolly (item 12).
    - **Contexto da produção no prompt:** "câmera na mão, sem trilho/dolly" → o modelo só diz
      travelling/dolly com sinal forte. Fonte: pergunta ao usuário no onboarding do projeto ou a análise
      do clipe inteiro (item 11).

16. **Blocos de trechos com a mesma ação (321, 2:54):** o modelo não viu o ator fumando num trecho, mas
    viu nos vizinhos dos dois lados — ele sempre esteve fumando. Juntar trechos vizinhos em blocos maiores
    por continuidade de ação/assunto, para a busca "ator fumando" devolver o bloco inteiro.
17. **O modelo perde o começo do trecho (321, 3:30) — resposta dada a ele em 08/10:** não é a
    sobreposição. Os 4 quadros caem em 1, 3, 5 e 7 s de cada trecho de 8 s; o 1º segundo e o último nunca
    são vistos, e entre um quadro e outro passam 2 s. Um zoom que acontece no 1º segundo e meio já está
    "pronto" no 1º quadro e some. A sobreposição de 2 s existe para o que cai na emenda aparecer em dois
    trechos. Caminhos: mais quadros (8 por trecho, ou 1/s), incluir as pontas, e sobretudo medir o
    movimento localmente quadro a quadro (zoom = expansão radial, fácil de medir) e mandar ao modelo só o
    que a medida não resolve. Ele pediu para saber o porquê de qualquer mudança que isso traga.

## 5. Resultado do gabarito (08/10/2026)

Gabarito: `data/cache/plano_sequencia/gabarito_2026-10-08.json` = revisão (13) do Fernando com os
"chicote" frente/trás trocados por zoom (ele achava que chicote era zoom rápido). **Todos os 133 trechos**
revisados: 94 certos, 39 errados. Ressalva: ~93 foram marcados "certo" de forma rápida no fim; só ~40
tiveram olhar detalhado (errado, nota ou correção) — o acerto do modelo está inflado por ancoragem.
Na 1ª medição, só com os 67 revisados com calma, o modelo acertava 48% dos movimentos.

| | Modelo de visão | Talho hoje |
|---|---|---|
| Escala (sequência igual) | **98%** | CLIP 23% (só o fim: 46%); erro típico: "americano" no lugar de médio/geral |
| Movimento (sequência igual) | **72%** (48% nos revisados com calma) | fluxo óptico 12% |

- **Zoom é o ponto cego:** 26 trechos têm zoom; o modelo disse zoom em 3, dolly em 7, outra coisa em 16.
  `classify_motion` já calcula `estimateAffinePartial2D` e **joga fora a escala** — medir zoom é quase
  de graça.
- **Deslocamento:** dos 21 travelling/dolly/órbita, 4 ficaram como "certo" na marcação rápida
  (provavelmente pan/zoom — o filtro "Marcados certos com deslocamento" do relatório acha); o resto virou
  pan, caminhando, zoom.
- **Caminhando:** o fluxo diz caminhando em 92 trechos; 14 têm caminhando de fato, 37 são só câmera
  tremida/na mão, 41 nem isso. Ele pega 14 dos 20 caminhando reais (o modelo, 17). O Fernando disse que
  caminha muito com a câmera na mão e **não marcou os momentos exatos** em que caminha — o gabarito de
  caminhando está subcontado. O erro real do fluxo: confundir **tremida com caminhando**.
- 17 trechos têm sequência de mais de um movimento: 8 s é longo para um rótulo só.
- "Na mão" em 33/133 no gabarito contra 14 do modelo — reforça a análise do clipe inteiro (item 11).
- **Chicote:** o Fernando achava que era zoom rápido. Os chicotes marcados "certo" (321 1:18,
  388 1:24, 388 3:30) podem ter sido aceitos com esse entendimento — conferir com ele.
- Pode ignorar: 321 3:24 escala repetida (clique duplo); 388 0:12 errado só na descrição.

Revisão do Fernando no clipe 321 (24 trechos, 0:00–2:20; 18 certos, 6 errados, com notas longas) em
`Downloads\revisao_plano_sequencia_2026-10-07-17-59 (2).json`. A primeira versão (9 trechos) é o
arquivo sem "(2)". O relatório tem "Importar revisões". Leia as notas: são a melhor fonte desta lista.

## 4. Como começar

1. Perguntar se o Fernando já revisou (JSON `revisao_plano_sequencia_*.json` em Downloads). Se sim,
   medir acerto do modelo vs. CLIP vs. fluxo óptico por escala e movimento antes de qualquer decisão.
2. Propor a ordem de integração (sugestão: corrigir `classify_motion` → tabela/colunas de trechos no
   banco ligada a `media_segment` → regra de junção melhor → rostos por trecho → faixas na timeline →
   esquema por IA). Perguntar antes de mexer no banco.
3. Commitar os scripts desta sessão **só se o Fernando pedir** (ver regras).

## Também desta sessão

- NVIDIA VSS ficou como sugestão adiada: seção 6 de `07_pendencias_externas.md`.
- Máquina: sem GPU NVIDIA (Intel UHD 630, 32 GB), sem Ollama. Modelo de visão local na CPU seria
  lento; o Fernando escolheu API pelo Talho para o teste.

## Regras deste repositório

- Leia o `CLAUDE.md` da pasta `dev`. Outra sessão mexe na interface: commit só dos seus trechos,
  direto na main, sem coautoria, sem push.
- Chaves só pelas Configurações ou `.env`; nunca no código, no log ou no chat.
- Scripts de edição em arquivo, com `PYTHONUTF8=1`. Português, direto. Verifique antes de afirmar.
