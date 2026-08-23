# 💰 Custos & Segurança: Melhores Práticas para APIs e Chaves

O **CapIAu-Talho** foi arquitetado sob um **Modelo Híbrido Otimizado**
com o objetivo de reduzir drasticamente os custos operacionais de IA na
nuvem e garantir a proteção absoluta de suas credenciais.

Abaixo estão as diretrizes fundamentais de segurança e economia
recomendadas para o uso do sistema em produção:

## 1. Diretrizes de Segurança (Proteção de Credenciais)

### 🔑 Isolamento Absoluto de Chaves de API

- Suas chaves (OPENROUTER_API_KEY e ASSEMBLYAI_API_KEY) devem residir
  **exclusivamente** no arquivo local `.env` (modelo em [`.env.example`](../.env.example)).

- **NUNCA comite o arquivo .env para repositórios públicos ou privados
  do GitHub.** O arquivo está listado no seu
  [`.gitignore`](../.gitignore) para prevenção automática de
  vazamento, mas certifique-se de não forçar a adição do arquivo por
  engano.

- Se for necessário hospedar ou compartilhar o código, forneça apenas o
  arquivo .env.example com placeholders vazios.

### 🛡️ Controle e Escopo das Chaves

- **Limitação de IP e Referrer (OpenRouter):** No painel da sua conta
  OpenRouter, você pode configurar chaves restritas para domínios
  específicos (ex: localhost:8000) se desejar aumentar o nível de
  controle.

- **Rotação de Credenciais:** É uma boa prática rotacionar suas chaves
  de API a cada 6 meses ou imediatamente caso suspeite de vazamento de
  logs.

- **A Chave do Auphonic Tem Casa Própria (*secret*):** A chave da nuvem
  de áudio não vive no `.env`: ela é cadastrada em **Configurações \>
  Modelos & Chaves** (chave `api.auphonic_key`, tipo *secret*, com
  fallback na variável de ambiente `AUPHONIC_API_KEY`). Sendo *secret*,
  aparece sempre mascarada no painel e o valor real nunca volta ao
  cliente.

## 2. Estratégias de Economia e Custo-Benefício

O CapIAu-Talho foi desenhado para processar 20 horas de vídeo por
**menos de R\$ 30,00**. Para manter o consumo no limite de economia
máxima, siga as regras abaixo:

### 🎙️ Transcrição Otimizada (AssemblyAI)

- **Extração Monofônica Local:** O sistema extrai e converte o áudio dos
  vídeos para arquivos MP3 Mono de 16kHz locais antes de enviá-los à
  API. Isso diminui o arquivo de áudio enviado em mais de 99% em relação
  ao vídeo original em 4K, economizando sua banda de internet e
  reduzindo o tempo de transmissão para poucos segundos.

- **Ignorar B-Rolls:** A rota de transcrição em lote
  (/api/project/{id}/transcribe-all) ignora automaticamente mídias
  categorizadas como **B-Roll** ou imagens silenciosas, enviando para a
  API de transcrição apenas os clipes que são de fato entrevistas ou
  depoimentos. Certifique-se de marcar o metadado do vídeo como B-roll
  caso ele não possua falas.

### 👁️ Análise Visual Econômica (Gemini via OpenRouter)

- **Segmentação Real em vez de Relógio Fixo:** Desde a Etapa 2 do plano
  de implementação (`docs/PLANO_IMPLEMENTACAO.md`), o CapIAu-Talho não
  extrai mais 1 frame a cada 10s de forma cega. O vídeo é primeiro
  segmentado localmente (PySceneDetect + deriva de conteúdo, sem custo de
  API) em shots e beats, e apenas **1 keyframe representativo por
  segmento** é enviado para o modelo de visão — respeitando um teto de
  `vision.frame_interval` (default 10s) apenas como limite máximo de
  cobertura. Na prática isso tende a **reduzir** o número de chamadas de
  visão em vídeos com cortes rápidos ou tomadas estáticas longas,
  mantendo a mesma taxa apenas em planos-sequência muito dinâmicos. Evite
  reduzir `vision.frame_interval` para 1s ou menos, pois isso aumenta o
  teto de chamadas sem trazer ganho semântico relevante na busca.

- **Modelo Multimodal Correto:** O .env suporta o modelo
  google/gemini-3.1-flash-lite ou google/gemini-2.5-flash que oferecem
  um custo-benefício insuperável para análise e tags de imagens. Evite
  usar modelos como o GPT-4o ou Claude 3.5 Sonnet para análises em massa
  de milhares de frames, reservando-os apenas para prompts pontuais de
  refino editorial no Chat.

### ✍️ Processamento de Texto Ultravantajoso (DeepSeek via OpenRouter)

- **Modelo para Textos e RAG:** O CapIAu-Talho vem pré-configurado com o
  modelo deepseek/deepseek-chat (DeepSeek V3) para tarefas de chat e
  agrupamento de temas. O DeepSeek V3 é um dos modelos mais potentes e
  baratos do mercado.

- **Cache Inteligente do Qdrant Local:** Como a busca semântica é
  computada 100% na CPU local usando vetores pré-salvos no Qdrant, você
  pode realizar milhares de buscas por segundo sem gerar qualquer
  chamada de API paga para a nuvem. O OpenRouter é consultado apenas
  quando você digita perguntas específicas diretamente no chat do
  assistente.

- **Busca Visual e "Encontrar Similares" são gratuitos:** Os embeddings
  CLIP (imagem e texto multilíngue) rodam localmente na CPU via
  Sentence-Transformers, sem nenhuma chamada de API. Use a busca visual e
  o botão "Encontrar Similares" à vontade — o único custo é o
  processamento local de indexação (feito uma vez, durante a análise de
  visão).

### ☁️ Tratamento de Áudio na Nuvem com Cota Fixa (Auphonic)

- **O limite é conhecido: 2 h/mês, gratuitas e recorrentes.** O plano
  free do Auphonic renova todo mês e a cota restante fica visível no
  painel de tratamento (rota `/api/audio/nuvem/cota`).

- **A economia nº 1: não se manda entrevista bruta para a nuvem.** Manda-se
  o trecho selecionado. Com ~20% de aproveitamento típico, 3,5 h de bruto
  viram ~45 min de material usado — o que cabe num mês inteiro de cota.

- **Guardas contra gasto acidental:** sem chave configurada ou sem cota
  suficiente para o trecho, a rota recusa **antes de tocar na rede** (a
  leitura de cota é local, num JSON em `data/audio_cloud/` — nenhuma
  requisição acontece na guarda). A prévia de 15 s na nuvem é recusada de
  propósito: gastaria cota para responder o que o motor local responde de
  graça. E o submit nunca é repetido automaticamente: o identificador da
  produção fica gravado no banco e uma retomada (morte do worker, Ctrl+C)
  reacompanha a produção existente — reenviar cobraria a cota duas vezes.

### 🔊 O Custo de CPU e Disco do Tratamento Local

- **CPU:** o denoise por IA local (DPDFNet) roda na CPU com RTF 0,71 —
  uma entrevista de 22 min leva ~15 min de máquina, contra ~43 s da cadeia
  clássica de ffmpeg (~45x mais lento). Use o botão "Prever 15 s" para
  decidir antes de comprometer o clipe inteiro. O preço compra algo: o
  piso de ruído desce ~13 dB mais fundo que o filtro clássico.

- **Disco:** cada WAV tratado (48 kHz, 24 bits) ocupa ~360 MB por
  entrevista de 22 min em `data/audio_tratado/`. O cache por hash da
  cadeia evita reprocessar, mas não devolve espaço: se o disco apertar,
  apague os WAVs das cadeias que abandonou — o original nunca é tocado e
  o mesmo pedido recria o arquivo sob demanda.

### 📊 Limite de Custos e Alertas

- Recomendamos configurar **Hard Limits** (limites máximos mensais) e
  alertas de e-mail diretamente nas plataformas:

  - **OpenRouter:** Defina um limite de gastos mensais na aba *Settings
    \> Limits* (ex: limitar a \$5.00 USD).

  - **AssemblyAI:** Monitore o consumo através do dashboard de
    faturamento gratuito.
