# 💰 Custos & Segurança: Melhores Práticas para APIs e Chaves

O **CapIAu-Talho** foi arquitetado sob um **Modelo Híbrido Otimizado** com o objetivo de reduzir drasticamente os custos operacionais de IA na nuvem e garantir a proteção absoluta de suas credenciais.

Abaixo estão as diretrizes fundamentais de segurança e economia recomendadas para o uso do sistema em produção:

---

## 1. Diretrizes de Segurança (Proteção de Credenciais)

### 🔑 Isolamento Absoluto de Chaves de API
* Suas chaves (`OPENROUTER_API_KEY` e `ASSEMBLYAI_API_KEY`) devem residir **exclusivamente** no arquivo local [.env](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/.env).
* **NUNCA comite o arquivo `.env` para repositórios públicos ou privados do GitHub.** O arquivo está listado no seu [.gitignore](file:///c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP/.gitignore) para prevenção automática de vazamento, mas certifique-se de não forçar a adição do arquivo por engano.
* Se for necessário hospedar ou compartilhar o código, forneça apenas o arquivo `.env.example` com placeholders vazios.

### 🛡️ Controle e Escopo das Chaves
* **Limitação de IP e Referrer (OpenRouter):** No painel da sua conta OpenRouter, você pode configurar chaves restritas para domínios específicos (ex: `localhost:8000`) se desejar aumentar o nível de controle.
* **Rotação de Credenciais:** É uma boa prática rotacionar suas chaves de API a cada 6 meses ou imediatamente caso suspeite de vazamento de logs.

---

## 2. Estratégias de Economia e Custo-Benefício

O CapIAu-Talho foi desenhado para processar 20 horas de vídeo por **menos de R$ 30,00**. Para manter o consumo no limite de economia máxima, siga as regras abaixo:

### 🎙️ Transcrição Otimizada (AssemblyAI)
* **Extração Monofônica Local:** O sistema extrai e converte o áudio dos vídeos para arquivos MP3 Mono de 16kHz locais antes de enviá-los à API. Isso diminui o arquivo de áudio enviado em mais de 99% em relação ao vídeo original em 4K, economizando sua banda de internet e reduzindo o tempo de transmissão para poucos segundos.
* **Ignorar B-Rolls:** A rota de transcrição em lote (`/api/project/{id}/transcribe-all`) ignora automaticamente mídias categorizadas como **B-Roll** ou imagens silenciosas, enviando para a API de transcrição apenas os clipes que são de fato entrevistas ou depoimentos. Certifique-se de marcar o metadado do vídeo como B-roll caso ele não possua falas.

### 👁️ Análise Visual Econômica (Gemini via OpenRouter)
* **Taxa de Amostragem de Frames (10s):** Por padrão, a análise visual multimodal extrai 1 frame a cada **10 segundos** de vídeo B-roll. Para decupagem de bastidores, essa taxa é ideal. Evite reduzir essa taxa para 1s ou menos, pois isso aumentará o consumo de tokens de visão em até 10 vezes sem trazer ganho semântico relevante na busca.
* **Modelo Multimodal Correto:** O `.env` suporta o modelo `google/gemini-3.1-flash-lite` ou `google/gemini-2.5-flash` que oferecem um custo-benefício insuperável para análise e tags de imagens. Evite usar modelos como o GPT-4o ou Claude 3.5 Sonnet para análises em massa de milhares de frames, reservando-os apenas para prompts pontuais de refino editorial no Chat.

### ✍️ Processamento de Texto Ultravantajoso (DeepSeek via OpenRouter)
* **Modelo para Textos e RAG:** O CapIAu-Talho vem pré-configurado com o modelo `deepseek/deepseek-chat` (DeepSeek V3) para tarefas de chat e agrupamento de temas. O DeepSeek V3 é um dos modelos mais potentes e baratos do mercado.
* **Cache Inteligente do Qdrant Local:** Como a busca semântica é computada 100% na CPU local usando vetores pré-salvos no Qdrant, você pode realizar milhares de buscas por segundo sem gerar qualquer chamada de API paga para a nuvem. O OpenRouter é consultado apenas quando você digita perguntas específicas diretamente no chat do assistente.

### 📊 Limite de Custos e Alertas
* Recomendamos configurar **Hard Limits** (limites máximos mensais) e alertas de e-mail diretamente nas plataformas:
  * **OpenRouter:** Defina um limite de gastos mensais na aba *Settings > Limits* (ex: limitar a $5.00 USD).
  * **AssemblyAI:** Monitore o consumo através do dashboard de faturamento gratuito.
