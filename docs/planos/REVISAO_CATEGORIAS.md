# Revisão das categorias de triagem

> Escrito em 06/10/2026 a partir do código e do banco (projeto 2, acervo MONSTRO). As marcas
> **[DECIDIR]** foram decididas na seção 9; o que já está no código está na seção 13.
> Contexto: `docs/planos/ORDEM_DAS_ANALISES.md`.

## 1. Por que agora

- A categoria decide **quanto se gasta** em cada vídeo e **como ele é descrito**. A reanálise
  completa das 18,7 h vai custar milhares de quadros de visão (seção 6); fazer isso com uma
  taxonomia que vai mudar depois é pagar duas vezes.
- **É o momento mais barato para renomear:** só 24 de 550 vídeos têm categoria, nenhuma das 1.424
  fotos tem, e há 1 correção sua registrada. Depois da reanálise, renomear vira migração de dados.

## 2. O que existe hoje

Uma categoria por arquivo, escolhida entre 9 (`prompt_registry.py`, `TRIAGE_CATEGORIES`):

| Chave | Rótulo na tela | Definição dada à IA | Esforço | No acervo |
|---|---|---|---|---|
| `obra` | Obra (cena/take) | takes de cena, stills, material que pode ir ao corte final | completo | 2 |
| `processo` | Making of / Processo | making of, bastidores, montagem de set, equipe trabalhando | completo | 16 |
| `depoimento` | Depoimento | entrevistas e falas dirigidas à câmera | completo | 3 |
| `cotidiano` | Cotidiano da equipe | conversas informais, vida da equipe, registros sociais | **2 quadros** | 2 |
| `evento` | Evento | lançamentos, festivais, coletivas, celebrações | completo | 0 |
| `tecnico` | Material técnico | testes de câmera/luz/som, calibração, claquetes vazias | 1 por plano | 0 |
| `arquivo` | Arquivo / Terceiros | material de terceiros, banco de imagens, histórico | 1 por plano | 0 |
| `pessoal` | Pessoal / Sem relação | sem relação com o projeto | **2 quadros** | 0 |
| `documento` | Documento | papéis, telas, roteiros filmados | 1 por plano | 0 |

Mais 1 vídeo com `Trilha` (fora da lista) e 526 sem categoria.

**Onde a categoria age hoje**

| Onde | O que faz |
|---|---|
| Perfil de esforço | quantos quadros, se detecta beats, se cobre planos longos por intervalo |
| Prompt da visão (cada quadro) | "descreva o frame **dentro desse contexto**" |
| Resumo do vídeo | entra como contexto |
| Tipo do vídeo | `depoimento` vira `interview`, e o lote de visão **pula** `interview` |
| Busca | faceta de filtro no índice de imagens (CLIP) |
| Fila de revisão | incerta (confiança baixa ou vazia, ou Laya discordando) aparece para você |
| Fotos | mesma taxonomia (triagem de rajadas em `burst_service.py`) |

## 3. Problemas, com evidência

1. **"arquivo" é ambíguo com "arquivo" (o ficheiro).** A pergunta da Laya é *"Que tipo de material
   é este arquivo…"* e o prompt da triagem fala em "o arquivo como um todo". A Laya respondeu
   `arquivo` em 15 dos ~30 vídeos que comparou, quase sempre errado (9 viraram `processo`, 3
   `depoimento`, 2 `cotidiano`).
2. **"obra" depende de qual obra.** O acervo é o making of de MONSTRO. Para o filme, o take é a
   obra e a equipe trabalhando é processo. Para o **making of**, que é o produto deste projeto, o
   processo é a matéria-prima principal do corte. Hoje a definição de `obra` diz "material que
   pode ir ao corte final", o que no making of vale para quase tudo.
3. **Três perguntas misturadas numa lista só:**
   - o que está diante da câmera (cena, equipe, alguém falando, um papel);
   - a finalidade da gravação (teste, registro, cobertura de evento);
   - se interessa ao projeto (`pessoal`).

   Daí as fronteiras sem regra: teste de luz com equipe no set (`processo` ou `tecnico`?), roteiro
   na mão do diretor (`documento` ou `processo`?), ator dando entrevista no set (`depoimento` ou
   `processo`?), almoço onde se discute a cena (`cotidiano` ou `processo`?).
4. **`pessoal` como categoria** obriga a escolher entre "o que é" e "se interessa". Um vídeo do
   cachorro de alguém no set é cotidiano **e** fora do projeto.
5. **Depoimento com esforço visual completo.** Uma cabeça falando, com um quadro a cada 4 s:
   dos 22 vídeos com mais de 10 min (6,8 h), 15 são entrevistas e somam 5,5 h. O valor está na
   fala, que já é transcrita.
6. **A categoria no prompt de cada quadro** induz a descrição a confirmar a categoria (viés de
   confirmação). Se a triagem errou, a descrição erra junto.
7. **A confiança declarada não discrimina:** 21 dos 22 vídeos triados estão com ≥ 0,8. Já
   contornado no piso de esforço com a discordância da Laya; ver seção 7.
8. **Uma categoria para o arquivo inteiro.** Cartões descarregados em arquivos longos misturam
   cena, bastidor e conversa; 4 quadros fixos decidem por tudo.

## 4. Propostas de taxonomia

### Proposta A, ajuste fino (menor custo)

Mantém as 9 chaves (nada de migração de dados) e mexe só em rótulos, definições e regras:

- `arquivo` passa a ser apresentado como **"Terceiros"**, com definição que não use a palavra
  "arquivo"; os prompts da Laya e da triagem trocam "este arquivo" por "este material".
- `obra` e `processo` ganham definição relativa ao objetivo do projeto (seção 4.3).
- Regras de desempate no prompt (seção 5).

Resolve 1, 2 e 3 em parte. Não resolve 4.

### Proposta B, dois eixos (recomendada)

**Eixo 1: o que é** (uma escolha). As chaves novas são sugestão:

| Chave nova | Era | Definição |
|---|---|---|
| `cena` | `obra` | a encenação ou o assunto filmado como obra: take, plano de cobertura, still de cena |
| `bastidor` | `processo` | a equipe e o fazer: montagem, ensaio, direção, equipe trabalhando ao redor da cena |
| `depoimento` | `depoimento` | alguém falando para a câmera ou para um entrevistador, como foco do plano |
| `convivio` | `cotidiano` | vida da equipe fora do trabalho em cena: refeição, deslocamento, conversa solta |
| `evento` | `evento` | lançamento, festival, coletiva, celebração |
| `teste` | `tecnico` | plano feito para testar ou calibrar equipamento, sem cena nem trabalho de equipe em foco |
| `documento` | `documento` | papel, tela ou roteiro filmado para ser lido |
| `terceiros` | `arquivo` | material que não foi gravado pela produção: recebido, banco de imagens, histórico |

**Eixo 2: interessa ao projeto?** É uma marca, não categoria: `fora_do_projeto` (sim/não).
Substitui `pessoal`. Qualquer material pode estar fora do projeto, e marcado assim recebe esforço
mínimo, seja qual for o eixo 1.

Custo da B: renomear chaves em ~24 vídeos, 1 correção, as facetas do CLIP (80 pontos), o texto do
agente de onboarding, os rótulos da biblioteca (`library.js`, sessão de interface) e as smart bins
`categorias/Depoimento` (16 vídeos; o nome fica). A Laya e o Jev recebem as categorias do mesmo
dicionário, então mudam juntos. As decisões antigas da Laya (`system1_decisao`) são mapeadas
pela tabela "Era" acima.

**[DECIDIR]** A ou B? Se B, os nomes das chaves e se `convivio` e `bastidor` devem existir separadas.

### 4.3 Relativo ao projeto

**[DECIDIR]** O objetivo do projeto entra na triagem? Ex.: um campo "este projeto é: making of de
MONSTRO". Com ele, a regra fica explícita: num making of, `bastidor` é material de corte; num
filme, é registro. Sem ele, `cena` e `bastidor` descrevem só o que está diante da câmera, e o
valor editorial fica para a busca e o resumo (recomendado: descrever o que é, não o que vale).

## 5. Regras de desempate (para o prompt)

Em ordem; a primeira que se aplica vence. **[DECIDIR]** a ordem e o texto.

1. Não foi gravado pela produção → `terceiros`.
2. Alguém fala para a câmera ou para um entrevistador durante a maior parte → `depoimento`,
   mesmo no set.
3. O plano registra a encenação em si (atores em cena, claquete de take, câmera na posição da
   cena) → `cena`. Se registra a equipe **ao redor** da encenação → `bastidor`.
4. O objetivo do plano é testar equipamento e não há cena nem equipe trabalhando em foco →
   `teste`. Teste de luz com equipe montando → `bastidor`.
5. O que importa é ler o que está escrito → `documento`. Roteiro na mão de alguém em ação →
   `bastidor`.
6. Equipe fora do trabalho em cena → `convivio`. Conversa sobre a cena durante o almoço →
   `convivio` (o assunto vai para a descrição e a busca, não para a categoria).
7. Material misto: a categoria do que ocupa **mais tempo**, com a marca `misto` (seção 7).

## 6. Como a análise muda por categoria (proposta)

Hoje há um intervalo global (`vision.frame_interval` = 4 s no seu banco). A proposta é que o
intervalo e o resto venham do perfil de cada categoria. A segmentação já põe um quadro em cada
corte de plano e em cada mudança visual (beat); o intervalo só cobre planos longos sem corte.

| Categoria (nomes da B) | Quadros | Intervalo em plano longo | Beats | Detector de objetos* | ASR |
|---|---|---|---|---|---|
| `cena` | cortes + beats + cobertura | 6 s | sim | sim | se houver fala |
| `bastidor` | cortes + beats + cobertura | 6 s | sim | sim | se houver fala |
| `evento` | cortes + beats + cobertura | 8 s | sim | não | se houver fala |
| `depoimento` | **cortes + 1 a cada 30 s** | 30 s | não | não | **sempre (é o principal)** |
| `convivio` | 1 por plano, até 6 | – | não | não | se houver fala |
| `teste` | 1 por plano | – | não | não | não |
| `documento` | 1 por plano | – | não | não | não |
| `terceiros` | 1 por plano | – | não | não | se houver fala |
| `fora_do_projeto` (marca) | 2 | – | não | não | não |
| incerta (piso) | como `cena` | 6 s | sim | sim | se houver fala |

\* Só se o detector estiver ligado (`object.detector_engine`, hoje `none`).

Comparação com hoje: `convivio` sobe de 2 quadros para até 6 (2 era pouco para vídeo de 1 min
com vários planos); `depoimento` cai muito; `pessoal` vira marca.

**[DECIDIR]** os números. Estimativa para o acervo inteiro, só com o intervalo global (sem
categorias): 4 s ≈ 17 mil quadros; 6 s ≈ 11,5 mil; 8 s ≈ 8,7 mil; 10 s ≈ 7 mil. Com a tabela
acima, depoimentos longos saem quase de graça e o total cai bem; o número exato sai depois da
rodada de triagem, por categoria.

### Onde a categoria entra no texto

| Prompt | Hoje | Proposta |
|---|---|---|
| Visão de cada quadro | entra ("descreva dentro desse contexto") | **sai**: a descrição fica independente e pode desmentir a triagem |
| Resumo do vídeo | entra | fica |
| Triagem de fotos | mesma taxonomia | fica, com as mesmas regras |

**[DECIDIR]** tirar a categoria do prompt da visão. Efeito colateral: a descrição pode
contradizer a categoria, e isso vira um sinal de revisão (como a discordância da Laya).

## 7. Incerteza, misto e revisão

- **Incerta** = confiança vazia, abaixo de `triage.min_confidence` ou Laya discordando (já
  implementado). Recebe o perfil de `cena`.
- **Misto (novo)**: a triagem pode responder também `categorias_secundarias`. Se houver, marca
  `misto`, aplica o perfil mais caro entre elas e entra na fila de revisão. Categoria por trecho
  (segmento) fica para depois: é mudança de esquema e de interface.
- **Contradição da visão (novo, se a categoria sair do prompt)**: descrição que nega a categoria
  (ex.: categoria `teste`, descrição com atores em cena) entra na fila.

**[DECIDIR]** misto agora ou depois.

## 8. Ordem de execução

1. Você decide os **[DECIDIR]** deste documento.
2. Implemento: taxonomia, regras no prompt, perfis por categoria, prompt da visão; com testes.
   Interface (rótulos, filtros, marca `fora_do_projeto`) fica com a sessão de UI.
3. **Rodada só de triagem** nos 526 sem categoria (e nas fotos, se quiser), sem reanalisar nada.
   Custo: uma chamada de visão de 4 quadros por vídeo.
4. Você revisa a fila e corrige uma amostra (as correções viram exemplo para a triagem).
5. Estimativa de custo da reanálise **por categoria**, com o perfil novo.
6. Reanálise completa: lote de visão para b-roll; caminho por vídeo para depoimentos.

## 9. Lista de decisões

Decidido em 06/10/2026:

- [x] **Proposta B**, dois eixos (seção 4); `pessoal` vira a marca `fora_do_projeto`
- [x] **Objetivo do projeto entra na triagem** (4.3)
- [x] **Marca `misto`** entra agora (seção 7)
- [x] **Fotos não entram na triagem de categoria.** A "triagem" das fotos é achar sequências
  quase iguais para analisar uma só (seção 10)

- [x] **Nomes das chaves** da proposta B: `cena`, `bastidor`, `depoimento`, `convivio`, `evento`,
  `teste`, `documento`, `terceiros` + marca `fora_do_projeto`
- [x] **Regras de desempate** da seção 5, na ordem proposta
- [x] **Categoria sai do prompt da visão**, com a confirmação depois da visão (seção 11, duas etapas)

Em aberto:

- [ ] Tabela de análise por categoria: números. **Calibrar com testes antes** (seção 12)
- [ ] Limiar do agrupamento de fotos: medição recomenda 0,93 (seção 10)

## 10. Fotos: agrupar sequências, não categorizar

Já existe o agrupamento de rajadas (`burst_service.py`, E2.B4): fotos da mesma pasta, com até
`burst.time_window_s` (30 s) de distância e similaridade CLIP acima de
`burst.similarity_threshold` (0,97), formam um grupo; a visão roda só na líder e as outras herdam
descrição e título. Todas continuam na biblioteca.

No acervo, **as 1.424 fotos foram analisadas uma a uma e nenhuma está em grupo**
(`burst_group_id` vazio em todas): a análise é anterior ao agrupamento, ou o CLIP estava
desligado. Antes de reanalisar fotos: rodar o agrupamento **sem visão** (só CLIP local, custo
zero) e medir quantos grupos saem com 0,97 e com limiares menores. "Quase iguais" pode pedir
algo como 0,93 a 0,95; o número sai da medição, não de chute.

**Medição de 06/10/2026** (só leitura; CLIP local sobre os proxies; mesma regra do
`burst_service`: compara com a líder, mesma pasta, teto de 30 por grupo):

| Limiar | Chamadas de visão (de 1.424) | Economia | Grupos com 2+ | Maior grupo |
|---|---|---|---|---|
| 0,97 (hoje) | 1.343 | 6% | 72 | 4 |
| 0,95 | 1.265 | 11% | 133 | 5 |
| **0,93** | **1.166** | **18%** | 196 | 5 |
| 0,90 | 1.021 | 28% | 270 | 6 |
| 0,85 | 843 | 41% | 366 | 8 |

- A data do arquivo é igual à data EXIF do clique em todas as fotos (mediana 0 h), e a janela de
  tempo quase não muda nada: 30 s, 120 s ou sem janela dão o mesmo resultado (diferença < 1%).
  Quem decide é a semelhança.
- Folhas de contato dos grupos de fronteira (que só se formam no limiar mais frouxo):
  - **0,93 × 0,97**: todos os pares são praticamente a mesma foto. Seguro.
  - **0,90 × 0,93**: mesma cena, mas às vezes entra uma pessoa nova no quadro. Perde detalhe.
  - **0,85 × 0,90**: junta páginas diferentes de um documento e grupos que mudaram de gente.
- Recomendação inicial: 0,93.

**Decisão final (06/10/2026): limiar 0,80 e teto de 10 fotos por grupo** (commit `406346c`).
O Fernando conferiu as folhas de 0,88 a 0,80 e os grupos de fronteira são de fato a mesma
sequência (não eram documentos nem lugares diferentes, ao contrário da minha leitura). Com 0,80
são 736 chamadas de visão (48% de economia). O teto 10 faz uma sequência longa receber uma análise
a mais a cada 10 fotos. As fotos do grupo herdam só a descrição: mantêm o próprio vetor CLIP e os
rostos (detectados na ingestão para todas).

## 11. Quando a visão entra na decisão da categoria (proposta, em aberto)

Hoje a triagem já usa imagem: 4 quadros em posições fixas (10, 35, 60 e 85% da duração), mais
transcrição, nome, pasta e as correções humanas. A Laya, só texto, está em sombra. Os limites:

- 4 quadros fixos podem cair todos no mesmo plano e perder o que muda no arquivo;
- a categoria é decidida **antes** da análise, com pouca informação, e nunca é revista depois
  (a triagem só roda se o vídeo não tem categoria).

Proposta em duas etapas:

1. **Triagem inicial com quadros por plano.** A segmentação (local, sem custo de API) roda
   antes e a triagem recebe um quadro de cada plano (os mais longos primeiro, até 6), em vez de
   posições fixas. Vê o que muda no arquivo e já pode apontar `misto`. Serve para decidir o
   **esforço**; incerta continua indo para o piso completo.
2. **Confirmação depois da visão, na mesma chamada do resumo final.** O resumo (texto, não
   visão) já lê transcrição e descrições de todos os quadros. Passa a devolver também
   `categoria` e `categorias_secundarias`, julgando com tudo, mais o objetivo do projeto, **sem
   receber a categoria da triagem** (para não confirmar por viés). Custo extra: zero chamadas.
   - Concorda com a triagem: fica.
   - Discorda: vai para a fila de revisão com as duas respostas; se a nova pede mais esforço, a
     marca "análise desatualizada" (item 5) já cobre. Nada roda sozinho.
   - Para essa confirmação valer, a descrição de cada quadro precisa ser feita **sem** a
     categoria no prompt da visão.

## 12. Calibração dos números (proposta)

Os números da seção 6 são ponto de partida, não decisão. Calibrar com uma bancada que **não
grava no acervo** (mesmo espírito de `scripts/asr_comparar.py`):

1. **Amostra**, escolhida depois da rodada de triagem: ~12 vídeos, 2 ou 3 de `cena`, `bastidor`,
   `convivio` e `depoimento`, mais 2 marcados `misto`, de durações variadas (curto, médio, longo).
2. **Densidades**: cada vídeo passa pela visão em 3 densidades, por exemplo 1 quadro por plano,
   intervalo de 8 s e intervalo de 4 s, com e sem beats. Resultado em banco e índice temporários.
3. **Medidas por densidade**:
   - custo: quadros enviados à visão;
   - o que a densidade maior acrescenta: descrições que trazem algo novo (pessoa, objeto, ação)
     em relação à menor;
   - busca: consultas reais suas ("ator ajustando o figurino", "claquete do take 3") e em que
     posição o trecho certo aparece;
   - leitura às cegas: você compara resumos e descrições A/B sem saber a densidade.
4. **Regra de decisão**: por categoria, a menor densidade que não perde o que a maior encontra
   nas consultas e na leitura às cegas.

Custo da bancada: as chamadas de visão dos ~12 vídeos em 3 densidades (centenas de quadros, não
milhares). A estimativa exata sai quando a amostra for escolhida.

## 13. Implementado em 06/10/2026

| Commit | O que entrou |
|---|---|
| `25b848c` | Taxonomia B (8 chaves + marca `fora_do_projeto`), regras de desempate no prompt da triagem e na pergunta da Laya, `categorias_secundarias` (misto: perfil mais caro + fila de revisão), `project.objetivo` (rota `PUT /api/project/{id}/objetivo`) na triagem e na Laya, `normalizar_categoria` (aceita nome antigo), migração idempotente dos dados |
| `2cb8631` | `scripts/visao_calibrar.py`: bancada da seção 12 (dry-run por padrão; `--executar` chama a API) |
| `6e6bf74` | Triagem com um quadro por plano (6 planos mais longos), planos detectados uma vez e reaproveitados na segmentação |
| `3f14817` | Categoria fora do prompt da visão; o resumo com imagem julga a categoria (`video.categoria_resumo`), divergência vai para a fila e pode marcar a análise como desatualizada |

| `4266533`, `406346c` | Rajadas de fotos: limiar 0,80 e teto 10 por grupo (seção 10) |
| `f900939` | Rótulos da biblioteca na taxonomia nova (o modal de metadados pré-selecionava "Obra") |
| `3c26af0` | Welcome Hub pergunta o objetivo do projeto antes de criar |

Feito fora do código: `project.objetivo` do projeto 2 = "Making of do longa O Monstro que Reside
Dentro da Casa Acima da Colina". Backup antes das migrações: `data/capiau.db.antes-reanalise-20261006`.

Ainda não feito:

- **Números por categoria**: provisórios, os de antes. Calibrar com `scripts/visao_calibrar.py`
  (seção 12) depois da rodada de triagem.
- **Rodada só de triagem** (seção 8, passo 3): não há rota nem script ainda.
- **Áudio**: plano em `docs/planos/PLANO_AUDIO_CATEGORIAS.md` (categorias aprovadas, calibração pendente).
  O vídeo 555 (`Trilha`) vira `trilha` quando a camada de áudio existir.
- Campo de objetivo nas configurações do projeto (hoje só o Welcome Hub pergunta, na criação).


## 14. Feito em 07/10/2026: áudio, rodada de triagem e calibração

| Commit | O que entrou |
|---|---|
| `e12e23e` | Camada 1 do áudio: `video.natureza` (sem imagem ou imagem parada = `audio`), fora da visão |
| `f86c6e4` | Camada 2 do áudio: tipo de som local (PANNs Cnn10), só fala vai ao ASR (`docs/planos/PLANO_AUDIO_CATEGORIAS.md`, local) |
| `e1f8135` | `scripts/triagem_rodada.py`: só triagem, dry-run por padrão, piloto espalhado pela duração, teto de gasto, gasto real pelo `usage` da OpenRouter |
| `ebf7df9` | `scripts/triagem_relatorio.py`: relatório HTML para revisar (vídeo, falas clicáveis, Laya, JEV, revisão exportável em JSON) |

Piloto de 20 clipes (1,5 s a 66 min): **US$ 0,022** (US$ 0,0009 por clipe, 2.212 tokens de entrada
e 103 de saída em média), ~10 min. A estimativa feita antes (US$ 0,004 a 0,005 por clipe) supunha
~1.550 tokens por quadro; na prática são algumas centenas. Projeção para os 506 restantes: ~US$ 0,73.

Decisões do Fernando:
- **Laya e JEV seguem em sombra, para calibrar.** Quando estiverem calibrados, entram como
  confirmação da triagem (os dois juntos). No piloto: Laya concorda com a triagem em 3/20, JEV em
  10/20; nas 8 vezes em que o JEV declarou >= 0,9 ele bateu com a triagem. Laya e JEV não veem
  imagem (só nome, pasta, duração e fala).
- **A triagem devolve a distribuição** pelas 8 categorias (`video.triagem_detalhe`: distribuição,
  margem entre 1ª e 2ª, justificativa). `category_confidence` = probabilidade da escolhida. O
  exemplo `"confianca": 0.85` saiu do prompt (o modelo copiava o número). Calibrar com as revisões
  do relatório.
- **Nomes pela grafia do cadastro** (`src/nlp/nomes.py`, camada de semelhança no `name_fixer`):
  título da triagem e resumo. Diferença só de acento não é corrigida (o cadastro tem "Joâo Antonio
  Ator"). Roteiro, documentos de produção e créditos não estão neste computador; virão pela
  sessão de sincronização com o outro computador (ainda não implementada).

Pendências:
- A chave do TypeSafe salva nas Configurações (`api.typesafe_key`) é recusada (HTTP 401); a do
  `.env` funciona. O app usa a das Configurações: o Fernando decide qual fica.
- Rodada completa (506 vídeos): só quando o Fernando pedir, com o app fechado (Qdrant).
- Reindexar na busca as transcrições dos vídeos 39 e 361 (feitas com o app aberto no 1º piloto).

Ideias para depois (não agora):
- **Duas opiniões:** segunda chamada com outros quadros; discordância vai para a revisão. Ou outro
  tipo de análise que confirme a triagem.
- **Cruzar tudo no fim:** com todas as análises prontas (triagem, Laya, JEV, resumo, rostos,
  objetos, fala), comparar os sinais e sugerir alterações de categoria para revisão humana.
- **Mais tempo e custo por clipe** (mais quadros, modelo maior) pode melhorar a triagem: medir
  depois, contra as revisões.

### JEV como verificador (07/10/2026, à tarde)

Receitas do Jev Lab da OpenRouter (openrouter.ai/labs/jev). Entraram:
- `triage.jev_via`: **TypeSafe é o padrão** (o Fernando tem crédito lá); OpenRouter é opção
  (`typesafe/jev-1.13`, versão fixa, chave e custo da OpenRouter). O TypeSafe direto só aceita
  `jev-latest`: a versão que respondeu (hoje `jev-1.13.0`) fica em `system1_decisao.modelo_resposta`.
- `scripts/jev_verificar.py`: por clipe, JEV direto, JEV lendo o que a visão viu
  (`tarefa='triagem_com_visao'`) e **verificação** da categoria da triagem
  (`tarefa='verificacao_triagem'`: confirma / contradiz / insuficiente). Só acrescenta linhas.

No 2º piloto: JEV direto concorda em 10/20; com o texto da visão, 20/20 (eco: a justificativa já
carrega a resposta, vale pouco como confirmação); **verificador contradiz em 5/20 (#54, #36, #233,
#60, #204), e os 3 clipes que mudaram de categoria entre os dois pilotos estão entre eles.**
A confiança do verificador varia de verdade (0,28 a 1,0). A conferir contra as revisões do Fernando.
