# CapIAu: APIs Agregadoras — O "Coração" da Estratégia Híbrida

**Data:** 02/06/2026  
**Versão:** 2.1  
**Escopo:** Análise aprofundada de APIs agregadoras (AI Gateways / LLM Routers) como camada central de orquestração entre o cluster GPU local, APIs pagas individuais, e o motor do CapIAu. Inclui comparativo completo dos principais players, arquitetura recomendada, custos, e estratégia de routing inteligente.

---

## TL;DR — Por que uma API Agregadora muda tudo

Uma **API agregadora** (também chamada de *AI Gateway* ou *LLM Router*) é uma camada de software que se posiciona **entre o CapIAu e todos os provedores de IA** — modelos locais no cluster, APIs de LLM, APIs de visão, APIs de transcrição, etc. Em vez de o CapIAu integrar diretamente com dezenas de provedores (OpenAI, Anthropic, Groq, DeepSeek, AWS, Azure, Google, etc.), ele se conecta **uma única vez** à agregadora, e ela cuida do resto. Isso reduz a complexidade de integração de **N conexões para 1**, habilita **routing inteligente** (enviar tarefas simples para modelos baratos, complexas para modelos caros), provê **fallback automático** (se um provedor cai, troca para outro instantaneamente), e oferece **observabilidade unificada** (custo, latência, uso — tudo em um dashboard). A escolha recomendada para o CapIAu é **LiteLLM (self-hosted)** para controle total e custo zero de gateway, com **Cloudflare AI Gateway** como backup managed se necessário.

---

## 1. O Que é uma API Agregadora e Por que o CapIAu Precisa de uma

### 1.1 O Problema: Integração Direta é um Pesadelo

Sem uma agregadora, o CapIAu precisaria integrar diretamente com cada provedor:

| Provedor | Formato de API | SDK | Auth | Billing |
|:---|:---|:---|:---|:---|
| OpenAI (GPT-4o) | OpenAI-compatible | openai-python | API key | OpenAI dashboard |
| Anthropic (Claude) | Messages API | anthropic-python | API key | Anthropic console |
| Groq (Llama 70B) | OpenAI-compatible | groq-python | API key | Groq dashboard |
| DeepSeek | OpenAI-compatible | requests direto | API key | DeepSeek platform |
| AWS Rekognition | AWS SDK | boto3 | IAM credentials | AWS Billing |
| Google Cloud Vision | REST/gRPC | google-cloud-vision | Service account | GCP Billing |
| AssemblyAI | REST | assemblyai-python | API key | AssemblyAI dashboard |
| ElevenLabs | REST | elevenlabs-python | API key | ElevenLabs dashboard |
| Azure OpenAI | Azure-specific | openai-azure | Entra ID | Azure Billing |
| Mistral AI | Mistral API | mistralai-python | API key | Mistral dashboard |
| **Modelos locais (cluster)** | Ollama/vLLM/TGI | vário | Local | $0 |

**São 10+ integrações diferentes**, cada uma com: formato de request/response próprio, tratamento de erro específico, rate limiting diferente, sistema de billing separado, e dashboard de uso isolado. Quando um novo modelo é lançado (acontece a cada 2-4 semanas em 2026), a equipe precisa fazer uma nova integração.

### 1.2 A Solução: Uma Agregadora no Meio

```
SEM AGREGADORA (integração direta — complexo):

  CapIAu ──→ OpenAI
         ──→ Anthropic
         ──→ Groq
         ──→ DeepSeek
         ──→ AWS Rekognition
         ──→ Google Cloud Vision
         ──→ AssemblyAI
         ──→ ElevenLabs
         ──→ Azure
         ──→ Mistral
         ──→ Cluster Local (Ollama/vLLM)
         ──→ ... (novos provedores a cada mês)

  Total: 10+ integrações para manter


COM AGREGADORA (LiteLLM/OpenRouter — simples):

  CapIAu ──→ API Agregadora ──→ OpenAI
                          ──→ Anthropic
                          ──→ Groq
                          ──→ DeepSeek
                          ──→ AWS
                          ──→ Google
                          ──→ AssemblyAI
                          ──→ ElevenLabs
                          ──→ Cluster Local
                          ──→ ... (novos provedores = 1 linha de config)

  Total: 1 integração para manter
```

### 1.3 Benefícios Específicos para o CapIAu

| Benefício | Descrição | Impacto no CapIAu |
|:---|:---|:---|
| **Routing Inteligente** | Classifica a complexidade da tarefa e envia para o modelo mais barato que resolve | **70% das tarefas vão para modelos de $0.10/1M tokens**, 20% para médios, 10% para frontier |
| **Fallback Automático** | Se um provedor cai/falha, troca instantaneamente para outro | **Zero downtime** no pipeline de ingest/produção |
| **Caching** | Requests idênticos são cacheados, evitando chamadas repetidas | **Redução de 30-50% no custo** de tarefas recorrentes |
| **Observabilidade Unificada** | Dashboard com custo, latência, tokens, erros — todos os provedores em um lugar | Controle de budget em tempo real por projeto/perfil |
| **Virtual Keys** | Cria chaves de API separadas por projeto/perfil/usuário | Isolamento de custos: Ficção, Doc, TV cada um com seu budget |
| **Rate Limiting** | Controla RPM/TPM por chave, evitando estouro de quotas | Previne surpresas de billing |
| **Budget Enforcement** | Define limites de gasto por projeto; quando atinge, bloqueia ou re-roteia | Controle de custo automático |
| **Formato Unificado** | Todas as respostas vêm no formato OpenAI (independente do provedor) | Código do CapIAu não muda quando troca de modelo |

---

## 2. Comparativo Completo das APIs Agregadoras

![Comparativo de Agregadores](api_aggregator_comparison.png)

### 2.1 Matriz de Comparativo

| Agregadora | Tipo | Modelos | Markup | Self-hosted | Routing Inteligente | Fallback | Caching | Virtual Keys | Dashboard | Melhor Para |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| **LiteLLM** | Open-source proxy | 100+ | **$0** | **Sim** | Sim (weighted, cost, latency) | Sim | Sim (Redis) | Sim | Sim (Admin UI) | **Self-hosted, controle total, custo zero** |
| **OpenRouter** | Managed SaaS | 300+ | **5.5%** | Não | Básico (availability) | Sim | Não | Não | Básico | Exploração rápida, prototipagem |
| **Cloudflare AI Gateway** | Edge/Cloud | 350+ | **5%** (unified billing) | Não | Sim (cost, performance) | Sim | Sim | Sim | Sim | Quem já usa Cloudflare, edge caching |
| **AI/ML API** | Managed SaaS | **400+** | $0 (própria infra) | Não | Básico | Sim | Não | Sim | Sim | Maior cobertura multimodal (imagem, vídeo, áudio, 3D) |
| **Portkey** | Managed + OSS | 250+ | **$49/mês** + usage | Sim (OSS) | Sim (conditional) | Sim | Sim | Sim | Sim (avançado) | Enterprise, compliance, observabilidade |
| **Helicone** | Managed + OSS | Provider-dependent | **$20/mês** + usage | Sim (OSS) | Mínimo | Sim | Sim | Sim | Sim (analytics) | Observabilidade, analytics profundo |
| **Inworld Router** | Managed | 100+ | **$0** (pass-through) | Não | Sim (business metrics) | Sim | Sim | Sim | Sim | Routing por qualidade/custo/latência |

### 2.2 Análise Detalhada por Agregadora

#### **LiteLLM — A Escolha do CapIAu**

**LiteLLM** é um proxy server open-source (MIT license) que expõe uma única API OpenAI-compatible e roteia para 100+ provedores. É a escolha recomendada para o CapIAu por ser **self-hosted, gratuito, e extremamente flexível**.

| Aspecto | Detalhe |
|:---|:---|
| **License** | MIT (open-source, uso comercial ilimitado) |
| **Custo** | **$0** (você paga apenas os provedores subjacentes) |
| **Setup** | Docker container + PostgreSQL + Redis (opcional) |
| **Performance** | **8ms P95 latency** a 1.000 RPS |
| **Routing** | Weighted, cost-based, latency-based, round-robin, random |
| **Fallback** | Configurável: retry, cooldown, fallback chains |
| **Caching** | Redis-backed, TTL configurável (10s a 1 ano) |
| **Virtual Keys** | Sim, com budgets, rate limits, model allowlists |
| **Observability** | Dashboard admin UI, logging para Langfuse/MLflow/OpenTelemetry |
| **Usuários em produção** | Netflix, Lemonade, Rocket Money |

**Como funciona no CapIAu:**

```python
# O CapIAu faz UMA chamada — LiteLLM decide para onde enviar
import openai

client = openai.OpenAI(
    base_url="http://litellm-proxy:4000",  # endpoint do LiteLLM
    api_key="capiau-master-key"
)

# Routing automático: LiteLLM escolhe o provedor com base na config
response = client.chat.completions.create(
    model="capiau-router-llm",  # nome do router configurado
    messages=[{"role": "user", "content": "Analise esta cena e sugira cortes..."}],
    extra_body={"metadata": {"project_id": "doc_seca_2012", "profile": "documentary"}}
)
```

**Configuração de routing no LiteLLM (YAML):**

```yaml
model_list:
  # Router para tarefas SIMPLES (classificação, resumo rápido)
  - model_name: capiau-router-simple
    litellm_params:
      - model: "groq/llama-3.1-8b-instant"  # $0.08/1M output
        weight: 0.7
      - model: "deepseek/deepseek-chat"      # $0.28/1M output
        weight: 0.3
      fallback: ["groq/llama-3.1-8b-instant"]

  # Router para tarefas MÉDIAS (análise de cena, alinhamento roteiro)
  - model_name: capiau-router-medium
    litellm_params:
      - model: "groq/llama-3.3-70b-versatile"  # $0.79/1M output
        weight: 0.6
      - model: "deepseek/deepseek-chat"          # $0.28/1M output
        weight: 0.4
      fallback: ["groq/llama-3.3-70b-versatile", "openai/gpt-4.1-mini"]

  # Router para tarefas COMPLEXAS (decisão editorial, justificativa criativa)
  - model_name: capiau-router-complex
    litellm_params:
      - model: "anthropic/claude-opus-4-6"  # $25/1M output
        weight: 0.5
      - model: "openai/gpt-5.4"              # $15/1M output
        weight: 0.5
      fallback: ["anthropic/claude-sonnet-4-6", "openai/gpt-5.4"]

  # Router para modelos LOCAIS (cluster GPU)
  - model_name: capiau-router-local
    litellm_params:
      - model: "openai/qwen2.5-72b"  # via vLLM/OpenAI-compatible endpoint no cluster
        api_base: "http://cluster-node2:8000/v1"
        weight: 1.0

# Budgets por projeto
router_settings:
  routing_strategy: "usage-based-routing"
  
general_settings:
  master_key: "sk-capiau-master"
  
# Virtual keys com budgets
key_management:
  - key_alias: "fiction-proj-01"
    max_budget: 100.00  # $100/mês
    allowed_models: ["capiau-router-simple", "capiau-router-medium", "capiau-router-complex"]
    
  - key_alias: "doc-proj-secas"
    max_budget: 200.00
    allowed_models: ["capiau-router-simple", "capiau-router-medium", "capiau-router-local"]
    
  - key_alias: "tv-news-plantao"
    max_budget: 500.00
    allowed_models: ["capiau-router-simple", "capiau-router-medium"]
    rpm_limit: 1000
```

#### **OpenRouter — Alternativa Managed**

OpenRouter é o agregador mais conhecido, com **300+ modelos** e billing unificado. O problema é o **markup de 5.5%** sobre todos os tokens — em um cenário de $10.000/mês em APIs, isso é $550/mês só de taxa de gateway. Além disso, não oferece self-hosting.

| Prós | Contras |
|:---|:---|
| 300+ modelos prontos | 5.5% markup em tudo |
| Setup instantâneo (SaaS) | Não pode self-host |
| Playground para testar modelos | Routing básico (availability-based) |
| Billing unificado | Sem virtual keys |
| API OpenAI-compatible | Sem caching nativo |

**Veredito:** Bom para prototipagem rápida, mas **LiteLLM é superior para produção** do CapIAu por ser gratuito e self-hosted.

#### **Cloudflare AI Gateway — Opção Edge**

Se o CapIAu já usa Cloudflare (CDN, DNS, Workers), o AI Gateway é uma extensão natural. Oferece **350+ modelos**, caching edge, rate limiting, e DLP (Data Loss Prevention). O **markup é de 5%** em unified billing.

| Prós | Contras |
|:---|:---|
| Integração nativa com Cloudflare | 10-50ms de latência extra (proxy) |
| Caching edge (reduz latência global) | Requer conta Cloudflare |
| DLP scanning gratuito | Log retention limitada (free: 100K logs) |
| Zero Data Retention mode (compliance) | Menos flexível que LiteLLM |
| 5% fee em credits | |

**Veredito:** Excelente como **camada secundária** (caching + DLP) se já usa Cloudflare. Não substitui LiteLLM como gateway primário.

#### **AI/ML API — Maior Cobertura Multimodal**

Com **400+ modelos** cobrindo texto, imagem, vídeo, áudio, música, 3D e OCR, é o agregador mais completo em termos de cobertura. Preços competitivos, pay-as-you-go a partir de $20.

| Prós | Contras |
|:---|:---|
| 400+ modelos (maior cobertura) | Managed only (não self-hosted) |
| Multimodal completo (vídeo, 3D, música) | Menos maduro que LiteLLM/OpenRouter |
| OpenAI SDK compatible | Menos controle de routing |
| Pay-as-you-go, sem subscription | |

**Veredito:** Útil como **gateway secundário** para recursos multimodais que LiteLLM não cobre (geração de vídeo, música, 3D).

#### **Portkey — Opção Enterprise**

Focado em compliance, governança, e observabilidade enterprise. Oferece audit logs, RBAC, e guardrails avançados.

| Prós | Contras |
|:---|:---|
| Enterprise-grade observability | $49/mês + usage (não é gratuito) |
| Audit logs e compliance | Setup mais complexo |
| RBAC e team management | Overkill para CapIAu no estágio atual |
| Guardrails avançados | |

**Veredito:** Considerar apenas quando o CapIAu atingir **escala enterprise** com requisitos de compliance rigorosos.

---

## 3. Arquitetura do CapIAu com API Agregadora

### 3.1 Diagrama de Arquitetura Atualizada

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           C A P I A U  v2.1 — COM API AGREGADORA                        │
│                    LiteLLM (self-hosted) como camada de orquestração                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  CAMADA 4: INTERFACES (Ficção / Documentário / TV)                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                                     │
│  │   FICÇÃO    │  │DOCUMENTÁRIO │  │ TV/JORNAL   │                                     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                                     │
│         └─────────────────┼─────────────────┘                                            │
│                           │                                                            │
│                    ┌──────┴──────┐                                                      │
│                    │  FastAPI    │  ← API REST do CapIAu (única integração)            │
│                    └──────┬──────┘                                                      │
└───────────────────────────┼─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  CAMADA 3: API AGREGADORA — LiteLLM Proxy (self-hosted)                                 │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────┐       │
│   │  LiteLLM Proxy Server (Docker, dentro do cluster)                           │       │
│   │                                                                             │       │
│   │  Funcionalidades:                                                           │       │
│   │  • Unified API (OpenAI-compatible)                                          │       │
│   │  • Routing Inteligente (simple/medium/complex/local)                        │       │
│   │  • Fallback Automático (provider cai → troca instantânea)                   │       │
│   │  • Caching (Redis — 30-50% redução de custo)                                │       │
│   │  • Virtual Keys (1 por projeto/perfil — isolamento de budget)               │       │
│   │  • Rate Limiting (RPM/TPM por key)                                          │       │
│   │  • Budget Enforcement ($ por projeto — bloqueia quando atinge)              │       │
│   │  • Observability (dashboard de custo, latência, tokens)                     │       │
│   │                                                                             │       │
│   │  Conexões de saída:                                                         │       │
│   │  ├── LLM APIs (Groq, DeepSeek, Anthropic, OpenAI)                           │       │
│   │  ├── Vision APIs (GPT-4o Vision, AWS Rekognition)                           │       │
│   │  ├── STT APIs (AssemblyAI, ElevenLabs)                                      │       │
│   │  ├── Search APIs (Tavily, Serper, NewsAPI)                                  │       │
│   │  └── Cluster Local (Qwen2.5 72B, Qwen2-VL, WhisperX, YOLOv8)                │       │
│   │                                                                             │       │
│   │  Dashboard: http://litellm:4000/ui                                          │       │
│   └─────────────────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                            │
           ┌────────────────┼────────────────┬────────────────┬────────────────┐
           │                │                │                │                │
           ▼                ▼                ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   LLM APIs   │  │  Vision APIs │  │   STT APIs   │  │ Search APIs  │  │CLUSTER LOCAL │
│  (Groq etc.) │  │  (AWS etc.)  │  │ (AssemblyAI) │  │ (Tavily etc.)│  │ (7x RTX4000) │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

### 3.2 Fluxo de uma Requisição

```
1. Editor no CapIAu clica "Analisar cena #12"
   │
2. FastAPI recebe o request e envia para LiteLLM Proxy
   │   POST http://litellm:4000/v1/chat/completions
   │   Headers: Authorization: Bearer sk-capiau-fiction-01
   │   Body: {model: "capiau-router-medium",
   │          messages: [...],
   │          metadata: {project: "doc_seca_2012", profile: "documentary"}}
   │
3. LiteLLM analisa:
   │   • Qual router? → capiau-router-medium
   │   • Qual key? → sk-capiau-fiction-01
   │   • Budget atingido? → Não ($45 de $100 usados)
   │   • Rate limit ok? → Sim (45 RPM de 1000)
   │
4. LiteLLM aplica routing:
   │   • Weighted: 60% Groq Llama 3.3 70B, 40% DeepSeek V3.2
   │   • Cache hit? → Não (primeira análise desta cena)
   │
5. LiteLLM envia para provedor escolhido:
   │   → Groq Llama 3.3 70B (394 tok/s, ~$0.79/1M output)
   │
6. Resposta volta por LiteLLM:
   │   • Formato normalizado (OpenAI-compatible)
   │   • Metadata de custo: $0.0032
   │   • Latência: 1.2s
   │   • Logged no dashboard
   │
7. FastAPI retorna para o editor com a análise
```

---

## 4. Routing Inteligente: A Estratégia de Custo

### 4.1 Classificador de Complexidade

O CapIAu precisa de um classificador que decide qual "nível" de modelo usar para cada tarefa:

```python
# Módulo de routing no CapIAu (camada antes de chamar LiteLLM)
class TaskRouter:
    def classify_complexity(self, task_type, content_length, context):
        """
        Classifica a tarefa em: simple | medium | complex | local
        Retorna o nome do router LiteLLM a usar
        """
        scoring = 0
        
        # Pontuação baseada no tipo de tarefa
        task_scores = {
            'classification': 10,      # Simples
            'summarization': 20,       # Simples-médio
            'transcription_alignment': 30,  # Médio
            'scene_analysis': 40,      # Médio
            'editorial_decision': 70,  # Complexo
            'narrative_structure': 80, # Complexo
            'creative_justification': 90,   # Complexo
            'continuity_check': 50,    # Médio
            'broll_suggestion': 35,    # Médio
        }
        scoring += task_scores.get(task_type, 50)
        
        # Pontuação baseada no comprimento do conteúdo
        if content_length < 1000: scoring += 0
        elif content_length < 5000: scoring += 10
        elif content_length < 20000: scoring += 20
        else: scoring += 30
        
        # Contexto adicional
        if context.get('requires_reasoning'): scoring += 30
        if context.get('creative_judgment'): scoring += 40
        if context.get('multi_modal'): scoring += 20
        
        # Decide o router
        if scoring <= 25: return 'capiau-router-simple'     # Groq 8B / DeepSeek
        elif scoring <= 60: return 'capiau-router-medium'   # Groq 70B / DeepSeek
        elif scoring <= 85: return 'capiau-router-complex'  # Claude / GPT-5.4
        else: return 'capiau-router-local'                   # Qwen2.5 72B local
```

### 4.2 Distribuição de Tarefas por Nível

| Nível | % das Tarefas | Modelos | Custo/1M tokens | Exemplos no CapIAu |
|:---|:---|:---|:---|:---|
| **Simples** | ~70% | Groq Llama 3.1 8B, DeepSeek V3.2 | **$0.08-0.28** | Classificação, resumos curtos, extração de entidades, routing interno |
| **Médio** | ~20% | Groq Llama 3.3 70B, DeepSeek V3.2 | **$0.28-0.79** | Análise de cena, alinhamento roteiro-transcrição, sugestão de B-roll, detecção de furos |
| **Complexo** | ~8% | Claude Opus 4.6, GPT-5.4 | **$15-25** | Decisão editorial final, justificativa criativa, análise narrativa profunda, escolha entre takes |
| **Local** | ~2% | Qwen2.5 72B (cluster) | **$0** | Tarefas que cabem no modelo local mas precisam de 72B parâmetros |

### 4.3 Impacto Financeiro do Routing

![Economia com Agregadora](economia_agregador.png)

| Cenário (mensal) | Sem Routing (tudo GPT-4o) | Com Routing Inteligente | Economia |
|:---|:---|:---|:---|
| POC (100K tokens) | $15 | $5 | **67%** |
| Leve (1M tokens) | $150 | $45 | **70%** |
| Médio (10M tokens) | $1.500 | $350 | **77%** |
| Pesado (50M tokens) | $7.500 | $1.500 | **80%** |
| TV 24/7 (200M tokens) | $30.000 | $5.500 | **82%** |

---

## 5. Custos da API Agregadora

### 5.1 LiteLLM — Custo Zero de Gateway

| Componente | Custo | Notas |
|:---|:---|:---|
| **LiteLLM software** | **$0** | MIT license, open-source |
| **Infraestrutura** | ~$20-50/mês | Docker container em um dos nós do cluster (2GB RAM, 2 vCPU) |
| **PostgreSQL** | $0 (compartilhado) | Pode usar o mesmo SQLite/PostgreSQL do CapIAu |
| **Redis (caching)** | $0 (compartilhado) | Pode usar o mesmo Redis do RQ/job queue |
| **Markups sobre APIs** | **$0** | LiteLLM não adiciona markup — você paga o preço direto do provedor |
| **TOTAL gateway** | **~$20-50/mês** | Apenas custo de infra mínimo |

### 5.2 Comparativo: Custo Total com e sem Agregadora

Em um cenário de **Produção Média** ($2.170/mês em APIs):

| Item | Sem Agregadora | Com LiteLLM | Diferença |
|:---|:---|:---|:---|
| Custo das APIs | $2.170 | $2.170 | $0 (mesmo preço) |
| Taxa de gateway | N/A | **$0** | **Economia de $110-270** |
| (vs. OpenRouter 5.5%) | | (vs. $119) | |
| (vs. Cloudflare 5%) | | (vs. $109) | |
| Infra do gateway | N/A | $30 | +$30 |
| Custo de dev/integração | Alto (N integrações) | Baixo (1 integração) | Economia de semanas de dev |
| Observabilidade | Múltiplos dashboards | Dashboard único | Economia de tempo |
| Fallback manual | Sim | Automático | Menos downtime |
| **Custo efetivo** | **$2.170 + overhead dev** | **$2.200** | **LiteLLM paga pelo overhead eliminado** |

A verdadeira economia da agregadora não é no preço dos tokens (LiteLLM não cobra markup), mas na **redução drástica da complexidade de desenvolvimento e operação**. Integrar 10+ provedores manualmente levaria semanas de engenharia; com LiteLLM, é uma tarde de configuração YAML.

---

## 6. Recomendação Final para o CapIAu

### 6.1 Stack de APIs Agregadoras

| Função | Agregadora Primária | Agregadora Secundária | Justificativa |
|:---|:---|:---|:---|
| **LLM Routing** | **LiteLLM** (self-hosted) | Cloudflare AI Gateway (caching) | Controle total, custo zero, routing inteligente |
| **STT/Transcrição** | LiteLLM → AssemblyAI/ElevenLabs | — | Via LiteLLM proxy |
| **Vision** | LiteLLM → AWS Rekognition/GPT-4o | AI/ML API (multimodal) | Via LiteLLM proxy |
| **Busca Web** | Tavily API (direto) | Serper.dev (direto) | Não precisa de agregação (já é unificado) |
| **Arquivos** | Europeana/IA/Wikimedia (direto) | Getty Images API (direto) | APIs REST simples, não precisam de gateway |

### 6.2 Roadmap de Implementação da Agregadora

| Fase | Duração | Tarefa |
|:---|:---|:---|
| **Fase 0 (POC)** | 1 dia | Deploy LiteLLM em Docker no nó master, conectar Groq + DeepSeek |
| **Fase 1** | 2 dias | Configurar routers (simple/medium/complex), virtual keys por perfil |
| **Fase 2** | 1 dia | Integrar modelos locais do cluster (Qwen2.5 72B via vLLM) |
| **Fase 3** | 2 dias | Implementar classificador de complexidade no CapIAu |
| **Fase 4** | 1 dia | Configurar Redis caching, budgets, rate limiting |
| **Fase 5** | 1 dia | Dashboard de observabilidade, alertas de custo |
| **Total** | **~1 semana** | Gateway completo em produção |

### 6.3 Configuração YAML Final Recomendada

```yaml
# litellm_config.yaml — Configuração completa para o CapIAu

model_list:
  # ═══════════════════════════════════════════════════════════════
  # ROUTERS POR NÍVEL DE COMPLEXIDADE
  # ═══════════════════════════════════════════════════════════════

  - model_name: capiau-router-simple
    litellm_params:
      model: groq/llama-3.1-8b-instant
      api_key: os.environ/GROQ_API_KEY
    fallback: [deepseek/deepseek-chat]

  - model_name: capiau-router-medium
    litellm_params:
      model: groq/llama-3.3-70b-versatile
      api_key: os.environ/GROQ_API_KEY
      weight: 0.6
    fallback: [deepseek/deepseek-chat, openai/gpt-4.1-mini]

  - model_name: capiau-router-complex
    litellm_params:
      model: anthropic/claude-sonnet-4-6
      api_key: os.environ/ANTHROPIC_API_KEY
      weight: 0.7
    fallback: [openai/gpt-5.4, anthropic/claude-opus-4-6]

  # ═══════════════════════════════════════════════════════════════
  # MODELOS ESPECÍFICOS POR TAREFA
  # ═══════════════════════════════════════════════════════════════

  - model_name: capiau-transcription
    litellm_params:
      model: assembly_ai/universal-2
      api_key: os.environ/ASSEMBLYAI_API_KEY

  - model_name: capiau-vision
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
    fallback: [anthropic/claude-sonnet-4-6]

  - model_name: capiau-embedding
    litellm_params:
      model: openai/text-embedding-3-large
      api_key: os.environ/OPENAI_API_KEY
    fallback: [deepseek/deepseek-embedding]

  # ═══════════════════════════════════════════════════════════════
  # MODELOS LOCAIS (CLUSTER GPU)
  # ═══════════════════════════════════════════════════════════════

  - model_name: capiau-local-72b
    litellm_params:
      model: openai/Qwen/Qwen2.5-72B-Instruct
      api_base: http://cluster-node2:8000/v1
      api_key: sk-local

  - model_name: capiau-local-vl
    litellm_params:
      model: openai/Qwen/Qwen2-VL-7B-Instruct
      api_base: http://cluster-node3:8000/v1
      api_key: sk-local

# ═══════════════════════════════════════════════════════════════
# SETTINGS
# ═══════════════════════════════════════════════════════════════

router_settings:
  routing_strategy: "usage-based-routing"
  timeout: 30
  num_retries: 2
  retry_after: 1

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  proxy_batch_write_at: 60

# ═══════════════════════════════════════════════════════════════
# VIRTUAL KEYS (1 por projeto/perfil)
# ═══════════════════════════════════════════════════════════════

key_management_settings:
  - key_alias: "capiau-fiction"
    max_budget: 150.00
    budget_duration: "30d"
    allowed_models:
      - capiau-router-simple
      - capiau-router-medium
      - capiau-router-complex
      - capiau-vision
      - capiau-embedding
    tpm_limit: 100000
    rpm_limit: 500
    metadata:
      project_type: "fiction"
      team: "editorial-ficcao"

  - key_alias: "capiau-documentary"
    max_budget: 250.00
    budget_duration: "30d"
    allowed_models:
      - capiau-router-simple
      - capiau-router-medium
      - capiau-local-72b
      - capiau-local-vl
      - capiau-vision
      - capiau-embedding
    tpm_limit: 150000
    rpm_limit: 750
    metadata:
      project_type: "documentary"
      team: "editorial-doc"

  - key_alias: "capiau-tv-news"
    max_budget: 500.00
    budget_duration: "30d"
    allowed_models:
      - capiau-router-simple
      - capiau-router-medium
      - capiau-transcription
      - capiau-vision
    tpm_limit: 500000
    rpm_limit: 2000
    metadata:
      project_type: "tv_news"
      team: "editorial-tv"

# ═══════════════════════════════════════════════════════════════
# CACHING
# ═══════════════════════════════════════════════════════════════

caching:
  redis_host: redis
  redis_port: 6379
  default_ttl: 3600  # 1 hora
  supported_call_types: ["acompletion", "embedding"]
```

---

## 7. Checklist de Decisão

| Critério | LiteLLM | OpenRouter | Cloudflare | Portkey | Veredito |
|:---|:---|:---|:---|:---|:---|
| Custo de gateway | **$0** | 5.5% markup | 5% fee | $49/mês | **LiteLLM** |
| Self-hosted | **Sim** | Não | Não | Parcial | **LiteLLM** |
| Routing inteligente | **Sim** | Básico | Sim | Sim | **LiteLLM** |
| Virtual keys | **Sim** | Não | Sim | Sim | Empate |
| Caching | **Sim** | Não | Sim | Sim | Empate |
| Modelos suportados | 100+ | 300+ | 350+ | 250+ | Cloudflare/AI-ML API |
| Observabilidade | **Sim** | Básico | Sim | **Avançado** | Portkey (enterprise) |
| Setup | **1 dia** | 10 min | 30 min | 2-3 dias | **LiteLLM** |
| Escalabilidade | **Ilimitada** | Ilimitada | Ilimitada | Ilimitada | Empate |
| Community | **Ativa (GitHub)** | Ativa | Moderada | Crescendo | **LiteLLM** |
| **RECOMENDAÇÃO CAPAU** | **PRIMÁRIA** | — | Secundária (caching) | Futuro (enterprise) | |

---

*Documento complementar ao plano expandido do CapIAu. Para o contexto completo (cluster GPU, APIs individuais, Asset Sourcing, cenários de custo), consulte `capiau_apis_cluster_expandido.md`.*
