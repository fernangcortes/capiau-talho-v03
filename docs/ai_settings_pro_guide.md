# Masterclass & Guia Avançado --- Painel de Configurações da IA (Modo Profissional)

Este guia serve como um manual técnico e conceitual aprofundado para
editores seniores, diretores de pós-produção e engenheiros de workflow
trabalhando com o **CapIAu-Talho**. No Modo Profissional, o sistema
expõe todas as engrenagens internas de inteligência artificial, visão
computacional, agrupamento semântico e orquestração de agentes.

## 1. Filosofia de Controle e a Herança de Configurações

O CapIAu-Talho foi desenhado sob o princípio de que **IA não é uma caixa
preta de tamanho único**. Sets de filmagem reais variam drasticamente em
iluminação, acústica, estilo de montagem e ritmo narrativo. Um threshold
de reconhecimento facial excelente para um set de estúdio superexposto
gera ruído insustentável em um documentário intimista gravado à luz de
velas.

Para balancear flexibilidade com robustez, o sistema implementa um
**Motor de Resolução Hierárquica**:

graph TD

A\[\"Padrão de Fábrica (Código Python)\"\] \--\> B\[\"Configurações
Globais (SQLite: app_setting)\"\]

B \--\> C\[\"Personalizações do Projeto (SQLite: project_setting)\"\]

C \--\> D\[\"Configuração Resolvida em Runtime\"\]

### O Ciclo de Precedência

- Quando um serviço da IA solicita o valor de uma configuração (ex:
  faces.detector_score), o SettingsService verifica primeiro se existe
  um override gravado especificamente para o projeto ativo.

- Se não houver, verifica se há um override global para o aplicativo.

- Se nenhum override existir, o sistema faz o fallback automático para a
  constante codificada no registro padrão do sistema.

- Toda alteração nas tabelas de banco de dados invalida instantaneamente
  o cache interno da RAM (utilizando travas threading.Lock para
  segurança em threads de processamento concorrente de vídeo).

## 2. Módulo 1: O Coração dos Modelos (Models & Keys)

Nesta seção, configuram-se as chaves de acesso a serviços de nuvem e os
modelos principais de processamento cognitivo.

### Parâmetros e Impacto no Workflow

- **llm.text_model (Modelo de Texto Principal)**

  - *O que faz:* Define o cérebro que interpretará o chat-agente,
    formulará as sugestões de corte físico na timeline, fará resumos
    editoriais e nomeará os temas.

  - *Escolha Estratégica:*

    - **deepseek/deepseek-v4-flash / google/gemini-3.5-flash**: Modelos
      rápidos de baixa latência. Excelentes para diálogos comuns de chat
      e tarefas de NLP leves como resumos.

    - **anthropic/claude-5-sonnet**: Maior capacidade de raciocínio
      espacial e estrutural. Recomendado se você estiver delegando ao
      agente grandes reestruturações de timeline multipista em lote
      (rough cuts automáticos de B-roll), pois ele comete menos erros
      sintáticos em arrays JSON complexos.

- **Chaves de API (OpenRouter/AssemblyAI)**

  - *Mecânica de Máscara:* Ao serem salvas no banco SQLite
    (completamente local), o backend nunca as expõe de volta à
    interface. O endpoint de leitura retorna apenas uma assinatura
    mascarada (ex: sk-or-...-1234 ou ••••). Se o campo for limpo na UI,
    o backend volta a herdar a constante definida no arquivo .env
    físico.

## 3. Módulo 2: Otimização de Transcrição e Diarização (ASR & VAD)

O processamento de depoimentos e entrevistas envolve converter o áudio
das mídias ingeridas em texto pontuado e mapeado cronologicamente por
falante.

### O que é VAD (Voice Activity Detection)?

O VAD é o algoritmo local que analisa o sinal bruto de áudio para
determinar onde há atividade humana de voz e onde há silêncio. Ajustar
estes parâmetros dita o tamanho físico dos balões de diálogo que
aparecem na tela do editor.

### Parâmetros sob a Lupa

- **asr.vad_threshold (Sensibilidade do VAD)**

  - *Padrão:* 0.50 (faixa de 0.0 a 1.0).

  - *Ação física:* Define a energia necessária na onda de áudio para
    classificar um som como voz humana.

  - *Calibração:*

    - **Aumentar (ex: 0.65 - 0.75):** Para entrevistas gravadas em
      ambientes com alto ruído de fundo (ex: vento na praia, trânsito
      pesado, gerador de energia do set próximo). Impede que barulhos de
      metal ou vento sejam transcritos como \"fala\" ou criem blocos
      vazios de áudio.

    - **Diminuir (ex: 0.35 - 0.40):** Para depoimentos íntimos com tom
      de voz sussurrado ou entrevistados muito tímidos. Garante que
      falas em voz baixa não sejam ignoradas.

- **asr.max_silence_s (Silêncio Máximo para Agrupamento)**

  - *Padrão:* 2.0 segundos.

  - *Ação física:* Tempo máximo de silêncio permitido antes de forçar a
    criação de um novo balão de fala. Se o entrevistado parar por mais
    de \$N\$ segundos, o balão de transcrição atual fecha e um novo se
    inicia.

  - *Calibração:*

    - **Curtos (0.8s - 1.2s):** Para documentários dinâmicos com falas
      rápidas e diretas. Cria blocos curtos, fáceis de cortar e mover na
      timeline.

    - **Longos (2.5s - 3.5s):** Para documentários reflexivos, onde o
      entrevistado faz longas pausas dramáticas sem mudar de assunto.
      Evita retalhar o pensamento em dezenas de pequenos blocos na tela.

## 4. Módulo 3: Visão Computacional e YuNet (O Pipeline de Rostos)

O reconhecimento facial e decupagem automática de vídeo do CapIAu-Talho
ocorrem em cascata. O **Tier 0** é executado de forma 100% local na CPU
(ou GPU se disponível) do computador utilizando o par de redes neurais
ultra-leves **YuNet** (detecção) e **SFace** (extração de embeddings e
similaridade cosseno).

### A Matemática da Nitidez e Nitidez Laplaciana

Antes de enviar o crop de um rosto para o banco vetorial ou agrupamento,
o sistema calcula o **Filtro Laplaciano** da imagem para extrair sua
variância. \$\$\\text{Nitidez} = \\sigma\^2(\\nabla\^2 I)\$\$ Se o valor
for inferior ao threshold, o rosto é considerado borrado (desfocado pelo
movimento da câmera ou profundidade de campo rasa) e descartado para não
poluir o banco de dados.

### Parâmetros sob a Lupa

+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+

\| PARÂMETROS DE VISÃO LOCAL (TIER 0) \|

+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+\-\-\-\-\-\-\-\-\--+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+

\| Chave \| Default \| Comportamento em Produção \|

+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+\-\-\-\-\-\-\-\-\--+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+

\| faces.detector_score \| 0.60 \| Confiança mínima da YuNet \|

\| faces.nms_threshold \| 0.30 \| Supressão de Caixas Duplicadas \|

\| faces.blur_threshold \| 10.0 \| Filtro de nitidez Laplaciana \|

\| faces.dbscan_eps \| 0.38 \| Similaridade cosseno (distância)\|

\| faces.dbscan_min_samples \| 3 \| Amostras mínimas por personagem\|

+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+\-\-\-\-\-\-\-\-\--+\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--+

#### faces.detector_score (Sensibilidade de Detecção)

- **Ajuste:** Se abaixado para 0.45, a YuNet detectará rostos de perfil,
  na penumbra do set, ou cobertos por bonés/cabelo. Útil em sets de
  iluminação dramática (ex: chiaroscuro).

- **Risco:** Valores baixos demais geram falsas detecções (ex: texturas
  de madeira ou roupas sendo identificadas como rostos).

#### faces.nms_threshold (Supressão de Não-Máximos)

- **Ajuste:** Controla a sobreposição de retângulos na imagem. Se o
  detector colocar duas caixas de tamanhos ligeiramente diferentes no
  mesmo rosto, o NMS elimina a de menor confiança. Aumentar este valor
  permite caixas mais sobrepostas; diminuir força caixas mais separadas.

#### faces.blur_threshold (Variância Laplaciana Mínima)

- **Ajuste:** Para filmagens com câmeras de cinema com profundidade de
  campo muito curta (lentes anamórficas abertas em f/1.8 onde apenas os
  olhos estão em foco e o resto do rosto sofre bokeh sutil), abaixe para
  5.0 ou 6.0 para não descartar crops válidos.

- **Sets de Ação/Handheld:** Em filmagens de bastidores dinâmicas com
  câmera na mão (*shaky cam*), aumente para 15.0 para descartar
  agressivamente frames borrados por movimento, mantendo na biblioteca
  de rostos apenas fotos nítidas.

#### faces.dbscan_eps (Epsilon do DBSCAN)

- **Ajuste:** É o raio de busca do algoritmo de clustering. A distância
  cosseno máxima para considerar que duas faces pertencem ao mesmo ator.
  \$\$\\text{Distância Cosseno} = 1.0 - \\frac{\\mathbf{u} \\cdot
  \\mathbf{v}}{\|\\mathbf{u}\|\_2 \|\\mathbf{v}\|\_2}\$\$

  - **EPS Alto (ex: 0.45):** O algoritmo fica mais tolerante. Juntará o
    mesmo ator sob luz amarela quente de estúdio e luz azul externa fria
    no mesmo grupo.

  - **EPS Baixo (ex: 0.32):** O algoritmo fica exigente. Útil se você
    tiver gêmeos no elenco ou atores com características muito
    parecidas, impedindo a fusão acidental de personagens.

## 5. Módulo 4: Mecânica Narrativa & Agrupamento Temático (Themes)

Após a decupagem física de mídias e transcrições, a IA agrupa os trechos
(soundbites de entrevistas, visual descriptions de B-roll, metadados de
fotos) em categorias narrativas chamadas **Temas**. O CapIAu-Talho v2
realiza isso através de um algoritmo de **Clustering Híbrido** (MiniLM
local para agrupar vetores + LLM em nuvem apenas para dar nome aos
grupos formados).

### Os Parâmetros Narrativos

- **themes.cluster_distance (Distância Limite de Agrupamento)**

  - *Padrão:* 0.45 (Distância cosseno, 1.0 - similaridade).

  - *Impacto:* Dita a coesão de assunto dentro do mesmo tema.

    - **Diminuir (ex: 0.35):** Cria temas ultraespecíficos e focados.
      Ex: em vez de um único tema \"Fotografia\", o sistema separará em
      \"Lentes Anamórficas\", \"Iluminação de Set\" e \"Filtros de
      Lente\".

    - **Aumentar (ex: 0.55):** Agrupa os trechos em macrotemas amplos.
      Reduz o número total de temas do projeto, ideal para rough cuts
      rápidos de longas-metragens.

- **themes.match_threshold (Similaridade para Atribuição Incremental)**

  - *Padrão:* 0.60 (Similaridade cosseno).

  - *Impacto:* Quando uma nova mídia é inserida no projeto (ex: você
    importou mais duas entrevistas no meio da edição), o sistema extrai
    os embeddings de suas falas e tenta encaixá-las nos temas já
    existentes comparando-as com o centroide de cada tema. Se a maior
    similaridade for inferior a 0.60, o trecho permanece \"sem tema\"
    até a próxima rodada completa de re-clustering.

- **themes.title_merge_threshold (Mesclagem por Título)**

  - *Padrão:* 0.82

  - *Impacto:* Durante a consolidação de temas redundantes (função
    merge_similar_themes), a IA gera embeddings locais para os títulos
    criados pelo LLM. Se dois títulos forem semanticamente idênticos ou
    muito próximos (ex: \"Direção de Atores\" vs \"Orientação do
    Elenco\"), o algoritmo *Union-Find* mescla fisicamente os dois
    temas, migrando todos os segmentos, relações de chat e anotações
    para o tema canônico mais antigo ou com mais clipes associados.

## 6. Módulo 5: O Guia Definitivo de Prompts Editáveis

Os prompts determinam as regras cognitivas do assistente. Abaixo está a
tabela detalhada do catálogo padrão, suas variáveis requeridas e como
customizá-las no Modo Profissional.

### Mapa das Variáveis por Prompt

  ---------------------------------------------------------------------------------------
  **ID do Prompt**         **Descrição de    **Variáveis Obrigatórias  **Significado no
                           Uso**             no Texto**                Código**
  ------------------------ ----------------- ------------------------- ------------------
  vision                   Prompt que        {context_block}           Injeta o roster de
                           analisa imagens                             atores e objetos
                           do set/frames.                              conhecidos para
                                                                       forçar a
                                                                       identificação
                                                                       literal das
                                                                       coordenadas do
                                                                       frame.

  enrichment_rewrite       Reescreve         {original_description},   Junta a visão
                           descrições        {entities_block},         genérica com os
                           visuais           {replacements_block}      nomes confirmados
                           genéricas.                                  de rostos do Tier
                                                                       0.

  timeline_suggestion      Gera sugestões de {persona_block},          Injeta as mídias
                           corte (V1, V2,    {timeline_context},       da biblioteca e a
                           A1, A2).          {candidates_context},     estrutura física
                                             {brief_block}             da timeline para a
                                                                       tomada de decisões
                                                                       de edição.

  theme_naming             Nomeia os temas   {clusters_block},         Envia amostras de
                           resultantes dos   {existing_block}          diálogos agrupadas
                           vetores.                                    para o LLM gerar
                                                                       títulos adequados
                                                                       e profissionais.

  interview_summary        Sumariza          {formatted_transcript}    Cria resumos
                           depoimentos.                                editoriais por
                                                                       parágrafos para o
                                                                       motor RAG.

  broll_summary            Sumariza clipes   {formatted_visuals}       Transforma a
                           de cobertura                                sequência de
                           B-roll.                                     frames de 10s em
                                                                       um resumo
                                                                       narrativo
                                                                       coerente.

  theme_clustering         Identifica temas  {formatted_transcript}    Analisa
                           de falas no                                 transcrições
                           acervo.                                     brutas para
                                                                       sugerir temas
                                                                       estruturais do
                                                                       documentário.

  chatbot_system           Prompt de sistema {context_str}             Delimita a base
                           do chat                                     vetorial e ensina
                           contextual.                                 a IA a injetar
                                                                       links clicáveis de
                                                                       mídias (video_id,
                                                                       photo_id).

  agent_system             Prompt do Agente  {timeline_context},       Guia o
                           de Edição ativo.  {context_str}             function-calling
                                                                       de modificações
                                                                       físicas na
                                                                       timeline.

  rag_categorize           Agrupa categorias *(Nenhuma)*               Utilizado na barra
                           de termos de                                de buscas para
                           busca.                                      desambiguar e
                                                                       categorizar
                                                                       resultados
                                                                       semânticos.

  persona.montadora        Persona focada em *(Nenhuma)*               Injetado na
                           ritmo de cortes.                            variável
                                                                       {persona_block} de
                                                                       sugestões da
                                                                       timeline.

  persona.diretora         Persona focada em *(Nenhuma)*               Injetado na
                           estrutura                                   variável
                           narrativa.                                  {persona_block} de
                                                                       sugestões da
                                                                       timeline.

  persona.sound_designer   Persona focada em *(Nenhuma)*               Injetado na
                           trilha sonora.                              variável
                                                                       {persona_block} de
                                                                       sugestões da
                                                                       timeline.

  persona.colorista        Persona focada em *(Nenhuma)*               Injetado na
                           cobertura e                                 variável
                           jump-cuts.                                  {persona_block} de
                                                                       sugestões da
                                                                       timeline.
  ---------------------------------------------------------------------------------------

### Validação de Placeholders e Código 422

Se você tentar atualizar o prompt vision e esquecer de digitar
{context_block}, a chamada de API retornará um código de erro 422
Unprocessable Entity com a mensagem:

> \"Placeholder obrigatório \'{context_block}\' não foi encontrado no
> template.\"

Isso evita travamentos em background (erros silenciosos de Python do
tipo KeyError ou falhas na chamada render_prompt), garantindo que o
software continue funcionando mesmo se o usuário errar a edição.

## 7. Caderno de Receitas da Vida Real (Playbook)

### Receita A: O Set Noturno / Fantasia (Iluminação Dramática e Sombras)

- **Cenário:** Bastidores de um filme de terror ou drama intimista. Há
  muita penumbra, pouca luz de contorno e sombras fortes sobre os rostos
  dos atores. O detector padrão gera poucos personagens e não agrupa as
  aparições de forma consistente.

- **Configurações Profissionais a Aplicar:**

  1.  Selecione o **Escopo de Projeto** no painel de configurações.

  2.  Ajuste faces.detector_score para 0.45 (permite detectar rostos em
      subexposição).

  3.  Ajuste faces.blur_threshold para 4.5 (a granulação do ISO alto
      gera falso ruído que o filtro de blur descarta. Abaixar este
      threshold preserva esses rostos).

  4.  Ajuste faces.dbscan_eps para 0.42 (permite agrupar rostos do mesmo
      ator mesmo quando metade de sua face está sombreada na cena).

  5.  Salve e dispare o reprocessamento de mídias na aba de IA do
      Inspetor.

### Receita B: O Documentário Comercial de Ritmo Acelerado (Fast-paced Editing)

- **Cenário:** Prazos apertados para entregar um vídeo de bastidores
  ultra-curto (ex: Reels/TikTok). Você quer que a IA monte cortes
  rápidos, sem pausas e com sobreposição abundante de B-rolls cobrindo
  qualquer pausa de fala do entrevistado.

- **Configurações Profissionais a Aplicar:**

  1.  Selecione o **Escopo de Projeto** no painel de configurações.

  2.  Altere asr.max_silence_s para 0.8 (força o fatiamento de falas a
      qualquer leve pausa de respiração do entrevistado).

  3.  Altere timeline.max_suggestions (nas configurações avançadas) para
      12.

  4.  Vá para a aba **Prompts** ➔ Edite **Sugestões: Persona
      Montadora**:

> Você é uma MONTADORA sênior especialista em cortes rápidos para redes
> sociais.
>
> Seu foco é dinamismo: aplique cortes na trilha de falas V1 a cada
> respiro,
>
> nunca deixe o entrevistado falar por mais de 2.5 segundos sem cobrir
> com b-roll
>
> dinâmico (pista V2). Proponha ações INSERT frequentes em V2 para
> cobrir transições.

5.  Salve e peça sugestões de timeline ao assistente de chat usando a
    persona Montadora.

### Receita C: O Documentário de Arquivo Histórico (Restauração e Acervos Antigos)

- **Cenário:** O documentário utiliza fitas VHS de arquivo de baixa
  resolução (480p ou menos), com ruído de áudio analógico e gravações
  caseiras tremidas.

- **Configurações Profissionais a Aplicar:**

  1.  Selecione o **Escopo de Projeto**.

  2.  Altere asr.vad_threshold para 0.30 (o ruído de fita cassete
      analógica pode confundir a voz. Reduzir a sensibilidade do VAD
      ajuda a rastrear a voz mesmo com chiado de fundo).

  3.  Altere faces.blur_threshold para 2.0 (como a resolução máxima é de
      fita magnética antiga, o algoritmo de nitidez clássico laplaciano
      descartaria todos os rostos por parecerem borrados. Reduzir a 2.0
      permite catalogar as faces).

  4.  Altere faces.dbscan_eps para 0.45 (compensar a perda de qualidade
      do sensor antigo agrupando os rostos mesmo com baixa variação de
      cor).

  5.  Salve e execute as indexações de ASR e Rostos.
