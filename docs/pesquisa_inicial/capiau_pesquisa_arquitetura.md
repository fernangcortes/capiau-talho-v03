# CapIAu-Talho: Pesquisa de Arquitetura — Motor de Edição Automática com Inteligência Cinematográfica

**Data:** 02/06/2026  
**Versão:** 1.0  
**Escopo:** Planejamento e arquitetura do sistema CapIAu-Talho — análise de 27 questões técnicas divididas em 7 categorias, com classificação por dificuldade, matriz comparativa de tecnologias, diagrama de arquitetura proposto, schema de dados, papers acadêmicos, gaps identificados, roadmap e recomendação de stack final.

---

## TL;DR — Resumo Executivo

O CapIAu-Talho é viável tecnicamente com **stack open source predominantemente maduro**, mas exige **desenvolvimento customizado significativo** nos módulos de decisão editorial inteligente. Das 27 perguntas pesquisadas, **13 têm soluções bem estabelecidas** (fáceis de integrar) e **14 exigem pesquisa, engenharia ou adaptação não-trivial**. Os maiores desafios estão em: (1) **match-on-action e detecção de continuidade** em vídeo, (2) **fuzzy matching entre transcrição e roteiro** considerando improvisos, (3) **edição por duração fixa sem perda semântica** no perfil TV, (4) **busca semântica em tempo real em acervos de 500+ horas**, e (5) **sincronização áudio-vídeo sem timecode** para documentário. A arquitetura recomendada é **motor compartilhado plugin-based + três interfaces de perfil**, usando **SQLite para metadados estruturados, Qdrant para busca semântica, e uma camada de grafo em SQLite** para relacionamentos. O hardware mínimo (**RTX 4060 8GB**) suporta modelos de 7-9B parâmetros em quantização Q4, suficiente para LLM local, mas exige **orquestração cuidadosa** quando múltiplos modelos (LLM + VLM + ASR) competem por VRAM.

---

## 1. Classificação das 27 Perguntas: Fácil vs. Complicado

A análise abaixo separa cada pergunta em duas categorias: **FÁCIL** (solução open source madura, bem documentada, integração relativamente direta) ou **COMPLICADO** (requer R&D customizado, integração não-trivial, ou área de pesquisa ativa). A classificação considera o estado da arte em junho de 2026, com foco em ecossistema Python e licenças permissivas.

![Classificação das perguntas](classificacao_perguntas.png)

### Legenda de Classificação

| Classificação | Descrição |
|:---|:---|
| **FÁCIL** | Solução open source madura existe; integração é principalmente engenharia de wiring; documentação e comunidade ativa; baixo risco técnico. |
| **COMPLICADO** | Não existe solução pronta que atenda exatamente; requer pesquisa, adaptação significativa, ou desenvolvimento customizado; maior risco técnico e incerteza. |

---

### 1.1 Categoria A: Stack Tecnológico & Arquitetura

| # | Pergunta | Classificação | Justificativa |
|:---|:---|:---|:---|
| A1 | Melhor arquitetura modular para separar motor de análise de interfaces por perfil? | **COMPLICADO** | Existem frameworks (Intel Edge AI, DL Streamer) mas nenhum atende exatamente o caso de uso de edição assistida com 3 perfis distintos. Requer design arquitetural customizado com plugin system próprio. |
| A2 | Combinação de modelos locais (LLM + Vision + Audio) em RTX 4060 8GB? | **COMPLICADO** | Cada modelo individualmente funciona (Qwen2-VL-2B, Whisper-medium, Llama-3.2-3B), mas **executar os três simultaneamente** em 8GB VRAM exige orquestração cuidadosa (unload/load dinâmico) ou execução sequencial, o que impacta throughput. Não existe framework pronto para este gerenciamento. |
| A3 | ChromaDB vs Qdrant vs Weaviate para busca semântica em 500+ horas? | **FÁCIL** | Benchmarks extensivos disponíveis. **Qdrant** é o claro vencedor para self-hosted production: melhor QPS, menor RAM, filtering nativo, Docker image de 145MB. ChromaDB tem "cliff" de performance acima de 100K vetores. Decisão é engenharia, não R&D. |
| A4 | Schema de banco (SQLite + grafo) flexível para 3 perfis de "cena"? | **COMPLICADO** | SQLite é perfeito para metadados estruturados, mas **modelar"cena" polimorficamente** (ficção=roteiro, doc=tema, tv=pauta) sem rigidez requer design cuidadoso. A camada de grafo em SQLite (triplas RDF-like) é viável mas não existe pattern estabelecido para este caso específico. |
| A5 | Estado da arte em detecção de continuidade (match-on-action, eyeline)? | **COMPLICADO** | **Gap significativo.** Não existe biblioteca open source madura para detecção automática de match-on-action ou eyeline match. É área de pesquisa ativa (Computer Vision) mas com pouca aplicação prática disponível. Requer desenvolvimento customizado baseado em papers recentes. |

### 1.2 Categoria B: Workflow de Edição Automática

| # | Pergunta | Classificação | Justificativa |
|:---|:---|:---|:---|
| B6 | Representar decisões editoriais em estrutura de dados para EDL/XML/OTIO? | **COMPLICADO** | OTIO tem schema extensível, mas **modelar "decisão editorial"** (com justificativa, confiança, regras aplicadas) não é suportado nativamente. Requer extensão do schema OTIO + camada de abstração que traduza para cada formato de saída considerando regras diferentes por perfil. |
| B7 | Literatura acadêmica sobre automatic video editing com roteiro/treatment como input? | **FÁCIL** | Papers recentes existem e estão acessíveis: "From Long Videos to Engaging Clips" (2025), "AutoCut" (2026), "Learning to Cut by Watching Movies" (2021). A literatura é crescente mas ainda concentrada em highlight extraction, não em edição narrativa completa. |
| B8 | Diarização com overlap (múltiplas pessoas falando ao mesmo tempo)? | **COMPLICADO** | PyAnnote.audio suporta overlapping speech detection (OSD) mas com **DER de 28-73% em coletivas** (DISPLACE 2024 challenge). É o estado da arte, mas longe de "resolvido" para o caso de uso de jornalismo com muitos falantes sobrepostos. WhisperX + heurísticas de pós-processamento é o melhor caminho, mas requer tuning. |
| B9 | Sincronização áudio externo sem timecode (documentário)? | **FÁCIL** | Algoritmo de sync por waveform é **bem estabelecido** (cross-correlation + MFCC features). Todos os NLEs modernos implementam. Existe bibliotecas Python (librosa, scipy.signal.correlate) que permitem implementar sync automático. PluralEyes foi descontinuado mas o pattern é conhecido. |

### 1.3 Categoria C: Parsing e Documentação de Produção

| # | Pergunta | Classificação | Justificativa |
|:---|:---|:---|:---|
| C10 | Parser mais robusto para .fdx e .fountain em Python? | **FÁCIL** | **screenplay-tools** (wildwinter) é multi-linguagem (C++, JS, Python, C#), MIT license, parseia Fountain e FDX para estrutura comum. Screenplain também é estável. A integração é wiring direto. |
| C11 | Fuzzy matching entre transcrição e diálogo de roteiro? | **COMPLICADO** | Não existe biblioteca pronta para este caso específico. Requer combinação de: embeddings semânticos (BERTimbau para PT-BR), edit distance (Levenshtein), e heurísticas de contexto (tempo, personagem, cena). Whisper pode "alucinar" ou omitir; improvisos quebram alignment simples. |
| C12 | Padrão/biblioteca para extração de diárias de filmagem em PDF? | **COMPLICADO** | Diárias de filmagem **não seguem padrão universal** — cada produtora usa formatos diferentes (tabelas, texto livre, scans). Existe PyPDF, pdfplumber, Camelot para extração de tabelas, mas requer parsers customizados por formato + OCR para scans. |
| C13 | Extrair metadados técnicos de .mxf (XDCAM) e .braw (Blackmagic)? | **FÁCIL** | **FFprobe** (FFmpeg) extrai metadados técnicos de praticamente todo formato incluindo MXF. Para .braw, Blackmagic disponibiliza SDK com Python bindings. ExifTool também cobre MXF. É principalmente engenharia de parsing. |

### 1.4 Categoria D: Jornalismo Televisivo

| # | Pergunta | Classificação | Justificativa |
|:---|:---|:---|:---|
| D14 | Soluções open source/low-cost para NRCS? | **FÁCIL** | **Superdesk** (Sourcefabric) é NRCS open source completo, AGPL, usado por AFP e outras agências. Suporta MongoDB + Elasticsearch, tem Docker Compose pronto. É uma alternativa viável ou referência de arquitetura. |
| D15 | Transcrição em tempo real para teleprompter ao vivo? | **COMPLICADO** | Whisper original **não suporta streaming real-time** (processa chunks de 30s). faster-whisper + chunked streaming é o melhor caminho open source, mas latência de 1-5s é maior que soluções comerciais (AssemblyAI: ~200ms). Para teleprompter ao vivo, precisa de <500ms. Requer otimização cuidadosa ou fallback para API comercial. |
| D16 | Biblioteca Python para geração automática de lower thirds? | **COMPLICADO** | Não existe biblioteca Python dedicada. Lower thirds são tipicamente gerados em NLEs (Premiere, After Effects) com templates MOGRT. Para burned-in, pode-se usar **FFmpeg drawtext** ou Pillow com composição frame-a-frame, mas requer desenvolvimento de template engine própria. |
| D17 | Corte por duração fixa sem perder informação principal? | **COMPLICADO** | É um **problema de otimização com restrições**: remover pausas, hesitações e repetições até atingir duração alvo, preservando hierarquia informativa (lead > desenvolvimento > fechamento). Requer algoritmo de "shrinking" baseado em análise de importância semântica por segmento, possivelmente com LLM para scoring. |

### 1.5 Categoria E: Interface e Experiência

| # | Pergunta | Classificação | Justificativa |
|:---|:---|:---|:---|
| E18 | Framework frontend para preview + roteiro interativo + timeline? | **COMPLICADO** | Nenhum framework existente oferece esta combinação específica. Requer: (1) player de vídeo customizado (Video.js/Plyr) com proxy, (2) componente de roteiro/pauta interativo, (3) timeline virtual (pode inspirar-se em OTIOView ou componentes D3.js). É desenvolvimento frontend significativo. |
| E19 | Busca semântica em tempo real em 500+ horas sem latência inviável? | **COMPLICADO** | Com Qdrant + HNSW index + quantização, busca em milhões de vetores é <50ms. O problema é a **geração de embeddings em tempo real** (query do usuário) e a estratégia de chunking do vídeo. Requer: índice segmentado por projeto, cache de embeddings, e possivelmente BM25 híbrido para filtros rápidos. |
| E20 | Melhor estrutura de proxy para preview rápido? | **FÁCIL** | **FFmpeg + H.264 CRF 23, 720p, preset fast** é o padrão da indústria. Kdenlive, Premiere, Resolve todos usam proxy H.264. Para máxima compatibilidade: MP4 container, H.264 video, AAC audio. Geração em batch via FFmpeg é trivial. |

### 1.6 Categoria F: Integração e Standards

| # | Pergunta | Classificação | Justificativa |
|:---|:---|:---|:---|
| F21 | Nível de compatibilidade real de OTIO com editores profissionais? | **FÁCIL** | OTIO é suportado nativamente por **DaVinci Resolve**, **Avid Media Composer**, e **Premiere Pro (beta)**. É formatos básicos (cortes, tracks, timing) transferem bem; efeitos e metadados estendidos requerem handling customizado. Documentação é clara sobre limitações. |
| F22 | Gerar projeto Kdenlive programaticamente via Python? | **FÁCIL** | Kdenlive usa formato **MLT XML** (Generation 5 desde v23.04). É XML bem estruturado que pode ser gerado/manipulado com xml.etree.ElementTree ou lxml. Documentação do formato existe no repositório oficial. |
| F23 | EDL moderno ainda é suficiente ou XML/AAF são mandatórios? | **FÁCIL** | **EDL é legado** (formato "do século passado" segundo a própria Avid). XML e AAF são mandatórios para workflows profissionais com múltiplas tracks, efeitos, metadados. EDL ainda funciona para cortes simples mas é limitadíssimo. Decisão é clara: priorizar XML/OTIO/AAF. |
| F24 | Gerar AAF compatível com Avid Media Composer? | **COMPLICADO** | AAF é **formato binário complexo** (MXF-based). Existe pyavb para ler/criar bins Avid, mas geração de AAF completo com composição é não-trivial. A alternativa é gerar OTIO e usar adaptor do OTIO para AAF, mas o adaptor é parcial. Requer investigação do estado atual do pyavb ou uso de ferramenta intermediária. |

### 1.7 Categoria G: Ética, Legal e Escalabilidade

| # | Pergunta | Classificação | Justificativa |
|:---|:---|:---|:---|
| G25 | Garantir que metadados de rosto/emotion não violem LGPD/GDPR? | **COMPLICADO** | Biometria é **dado sensível** sob LGPD. Documentário e jornalismo com não-atores exigem **consentimento explícito** ou anonimização. Não existe solução técnica pronta que combine reconhecimento facial com gerenciamento de consentimento. Requer: hash de faces para pseudo-anonimização, controle de acesso aos embeddings, e RIAD/LIA documentada. |
| G26 | Quais modelos de IA são open source para uso comercial sem restrições? | **FÁCIL** | **Apache 2.0:** Qwen, Mistral, Falcon, OLMo. **MIT:** DeepSeek, Phi. **Llama License:** permite comercial até 700M MAU. Requer atenção a: Llama (restrição de uso para treinar outros LLMs), Gemma (usage policy), Qwen-72B (limite de 100M usuários). Para o CapIAu-Talho, **Qwen2.5-7B (Apache 2.0) + Mistral-Nemo-12B (Apache 2.0)** são escolhas seguras. |
| G27 | Containerizar pipeline de vídeo com GPU para execução multi-usuário? | **FÁCIL** | **NVIDIA Container Toolkit** + Docker é padrão de indústria. Vários repositórios de referência (decode-video-pytorch, nvidia-accelerated-pytorch-ffmpeg). O desafio é orquestração de múltiplos jobs concorrentes na mesma GPU, não a containerização em si. |

---

## 2. Matriz Comparativa de Tecnologias por Categoria

### 2.1 Transcrição de Fala (ASR)

| Tecnologia | Modelo Base | PT-BR | Diarização | Streaming | Licença | Local | VRAM |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **Whisper (OpenAI)** | large-v3 (1.5B) | Boa | Não | Não | MIT | Sim | ~6GB |
| **faster-whisper** | large-v3 | Boa | Não | Sim (chunked) | MIT | Sim | ~4GB |
| **WhisperX** | faster-whisper | Boa | **Sim** | Limitado | BSD-3 | Sim | ~4GB + diar. |
| **Whisper.cpp** | vários | Boa | Não | Sim | MIT | Sim (CPU) | N/A |
| **NVIDIA Parakeet** | Parakeet | Boa | Não | Sim (via sherpa-onnx) | CC-BY-4.0 | Sim | ~2GB |
| **AssemblyAI** | Proprietário | **Excelente** | Sim | **<200ms** | Comercial | Não | N/A |
| **distil-whisper-ptbr** | distil-large-v3 | **Excelente** (WER 8.2%) | Não | Limitado | MIT | Sim | ~3GB |

**Recomendação CapIAu-Talho:** **WhisperX** para ingest batch (transcrição + diarização + timestamps palavra-a-palavra). **faster-whisper** com chunked streaming para modo TV (teleprompter ao vivo), com fallback para AssemblyAI se latência <1s for crítica.

### 2.2 Visão Computacional (Análise de Vídeo)

| Tecnologia | Função | Resolução | PT-BR | Licença | Local | VRAM | Notas |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **YOLOv8 (Ultralytics)** | Detecção objetos/ações | Alta | N/A | AGPL | Sim | ~2GB | Detecção em tempo real, bem maduro |
| **YOLOv11** | Detecção + segmentação | Alta | N/A | AGPL | Sim | ~2GB | Versão mais recente |
| **Qwen2-VL (2B)** | Descrição semântica | Dinâmica | Sim | Apache 2.0 | Sim | **~4GB** | **Recomendado** — roda em RTX 4060 |
| **Qwen2.5-VL (3B)** | Descrição + OCR + VQA | Dinâmica | Sim | Apache 2.0 | Sim | ~6GB | Melhor que 2B, mais pesado |
| **LLaVA** | Descrição semântica | 336px | Limitado | Llama License | Sim | ~6GB | Menos preciso que Qwen-VL |
| **CLIP** | Embedding multimodal | 224px | N/A | MIT | Sim | ~1GB | Útil para busca semântica visual |
| **DeepFace** | Reconhecimento facial/emotion | Varies | N/A | MIT | Sim | ~2GB | Facilidade de uso, múltiplos backends |
| **InsightFace** | Reconhecimento facial | Alta | N/A | MIT | Sim | ~2GB | Mais preciso que DeepFace |

**Recomendação CapIAu-Talho:** **YOLOv8** para detecção de objetos/ações, **Qwen2-VL-2B** para descrição semântica (cabe em 8GB VRAM), **InsightFace** para reconhecimento facial, **DeepFace** para análise de emoção.

### 2.3 Banco de Dados e Busca Semântica

| Tecnologia | Tipo | Híbrido (vector+texto) | Escala | Latência p99 | Docker | Licença | Notas |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **Qdrant** | Vector DB | Sim (sparse+dense) | >100M vetores | **12ms @1M** | 145MB | Apache 2.0 | **Recomendado** — melhor custo/benefício self-hosted |
| **ChromaDB** | Vector DB | Limitado | <1M vetores | 35ms+ | 1.2GB | Apache 2.0 | Bom para prototipagem, não para produção |
| **Weaviate** | Vector+Semantic | **Sim (nativo)** | >100M | 18ms @1M | 280MB | BSD-3 | Bom para busca híbrida, mais complexo |
| **Milvus** | Vector DB | Sim | Billions | Otimizado | Grande | Apache 2.0 | Overkill para <10M vetores |
| **pgvector** | PostgreSQL ext. | Via PostgreSQL | <50M | Moderada | N/A | PostgreSQL | Útil se já usar PostgreSQL |
| **SQLite** | Relacional | N/A | Ilimitado (disco) | <1ms | N/A | Domínio público | Perfeito para metadados estruturados |

**Recomendação CapIAu-Talho:** **SQLite** para metadados estruturados (takes, cenas, personagens, timecodes), **Qdrant** para busca semântica (embeddings de transcrições, descrições visuais, diálogos).

### 2.4 Modelos de Linguagem (LLM Local)

| Modelo | Parâmetros | Licença | VRAM (Q4) | Tokens/s (RTX 4060) | Multilingual | PT-BR | Recomendação |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **Llama 3.2 (3B)** | 3B | Llama 3 | ~2GB | **~50 t/s** | Sim | Bom | Velocidade máxima |
| **Qwen2.5 (7B)** | 7B | Apache 2.0 | ~4.7GB | ~9 t/s | **29 idiomas** | **Excelente** | **Recomendado** — melhor balance |
| **Mistral-Nemo (12B)** | 12B | Apache 2.0 | ~7GB | ~7 t/s | Sim (PT incluso) | Bom | Maior capacidade, próximo do limite |
| **DeepSeek-R1 (7B)** | 7B | MIT | ~4.7GB | ~8 t/s | Sim | Bom | Raciocínio avançado, mais lento |
| **Phi-4 (14B)** | 14B | MIT | ~8GB (spill) | ~2 t/s | Sim | Bom | Não recomendado para 8GB |
| **Qwen3.5 (9B)** | 9B | Apache 2.0 | ~5GB | **~55 t/s** | Sim | Excelente | Se VRAM permitir (16GB+) |

**Recomendação CapIAu-Talho:** **Qwen2.5-7B-Instruct (Q4_K_M)** como LLM principal — Apache 2.0 (sem restrições comerciais), excelente em PT-BR, cabe confortavelmente em 8GB VRAM com ~9 tokens/s. **Llama 3.2-3B** como fallback rápido para tarefas simples.

### 2.5 Parsing de Documentação de Produção

| Tecnologia | Formatos | Licença | Qualidade | Notas |
|:---|:---|:---|:---|:---|
| **screenplay-tools** | .fountain, .fdx | MIT | Excelente | Multi-linguagem, parser incremental, tags customizadas |
| **screenplain** | .fountain → .fdx/.html/.pdf | MIT | Boa | CLI + library, maduro |
| **JumpCut (Rust)** | .fountain → .fdx/.html/.json | Open | Boa | Alternativa em Rust |
| **PyPDF2/pdfplumber** | .pdf | MIT | Variável | Extração de texto/tabelas de PDFs |
| **Camelot** | Tabelas em PDF | MIT | Boa | Especializado em extração de tabelas |
| **python-docx** | .docx | MIT | Excelente | Manipulação de Word |
| **OpenPyXL** | .xlsx | MIT | Excelente | Planilhas Excel |

### 2.6 Formatos de Intercâmbio Editorial

| Formato | Suporte NLE | Complexidade | Metadados | Recomendação CapIAu-Talho |
|:---|:---|:---|:---|:---|
| **OTIO** | Resolve (nativo), Avid, Premiere (beta), Blender, Nuke | Média | Extensível | **Formato nativo interno** — prioridade máxima |
| **XML (FCP/Premiere)** | Premiere, FCP, Resolve | Média | Bom | Saída para Premiere/Resolve |
| **AAF** | Avid Media Composer | **Alta** (binário) | Rico | Requer investigação (pyavb) |
| **EDL (CMX 3600)** | Universal | Baixa | Mínimo | Legado — evitar exceto para workflows simples |
| **Kdenlive (MLT XML)** | Kdenlive | Média | Bom | Saída nativa para Kdenlive |

---

## 3. Diagrama de Arquitetura Sugerida

O diagrama abaixo representa a arquitetura de **motor compartilhado + três perfis de interface**, com o princípio de que o motor de análise e o banco de dados são comuns, enquanto a lógica de decisão editorial e a interface se adaptam por perfil.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           C A P I A U  —  A R Q U I T E T U R A                         │
│                     Motor Compartilhado + Três Perfis de Projeto                        │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 3: INTERFACES POR PERFIL (Frontend + API REST específica)                        │
│                                                                                         │
│   ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐             │
│   │   PERFIL FICÇÃO     │  │   PERFIL DOCUMENT.  │  │   PERFIL TV/JORNAL  │             │
│   │   ─────────────     │  │   ────────────────  │  │   ───────────────── │             │
│   │ • Roteiro interativo│  │ • Treatment/temas   │  │ • Pauta da redação  │             │
│   │ • Decupagem técnica │  │ • Log de entrevistas│  │ • Teleprompter      │             │
│   │ • Storyboard linkado│  │ • B-roll semântico  │  │ • Lower thirds      │             │
│   │ • Heatmap cobertura │  │ • Mapa temático     │  │ • Countdown duração │             │
│   │ • Side-by-side edit │  │ • Furos narrativos  │  │ • Feed playout      │             │
│   └─────────────────────┘  └─────────────────────┘  └─────────────────────┘             │
│            │                        │                        │                           │
│            └────────────────────────┼────────────────────────┘                           │
│                                     ▼                                                   │
│   ┌─────────────────────────────────────────────────────────────────────────────┐       │
│   │              API REST UNIFICADA (FastAPI / Flask)                           │       │
│   │   /api/v1/projects/{id}/scenes  /api/v1/search  /api/v1/timeline            │       │
│   │   /api/v1/ingest  /api/v1/export/{format}  /api/v1/analysis/{type}          │       │
│   └─────────────────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: MOTOR CAPIAU (Shared Engine — Python + Plugin System)                         │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────┐       │
│   │                    PLUGIN SYSTEM (ativa/desativa módulos)                   │       │
│   │   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │       │
│   │   │ Ingest   │ │Transcri- │ │  Visão   │ │  Áudio   │ │  Texto   │         │       │
│   │   │ Pipeline │ │   ção    │ │          │ │          │ │  Tela    │         │       │
│   │   │ (.mts,   │ │ WhisperX │ │ YOLOv8   │ │PyAnnote  │ │ EasyOCR  │         │       │
│   │   │ .mxf,    │ │ (fala +  │ │ (objetos │ │ (diariz. │ │ /Paddle  │         │       │
│   │   │ .braw,   │ │ diariz.) │ │ ações)   │ │ falantes)│ │ OCR      │         │       │
│   │   │ .r3d)    │ │          │ │          │ │          │ │          │         │       │
│   │   └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │       │
│   │   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │       │
│   │   │ Metadados│ │  Faces   │ │   LLM    │ │  Busca   │ │  Export  │         │       │
│   │   │ Técnicos │ │ & Emoções│ │  Local   │ │  Semân.  │ │ (EDL/XML │         │       │
│   │   │FFprobe/  │ │DeepFace/ │ │ Qwen2.5  │ │ Qdrant   │ │ /OTIO/   │         │       │
│   │   │ExifTool  │ │InsightF. │ │ 7B Q4    │ │ + Embedd.│ │ Kdenlive)│         │       │
│   │   └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │       │
│   └─────────────────────────────────────────────────────────────────────────────┘       │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────┐       │
│   │              DECISION ENGINE (Lógica editorial por perfil)                  │       │
│   │                                                                             │       │
│   │   Ficção:              Documentário:           TV/Jornalismo:               │       │
│   │   • Alinhamento        • Índice de revelação   • Corte por duração          │       │
│   │     roteiro-take       • Sinceridade emocional  • Lead preservation        │       │
│   │   • Cobertura cena     • B-roll semântico      • Lower third auto          │       │
│   │   • Match-on-action    • Furos narrativos      • Template de programa      │       │
│   │   • Performance ator   • Arco emocional        • Transcrição streaming     │       │
│   │                                                                             │       │
│   └─────────────────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: DADOS E ARMAZENAMENTO                                                         │
│                                                                                         │
│   ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐             │
│   │   SQLite (struct)   │  │  Qdrant (vectors)   │  │  Grafo em SQLite    │             │
│   │   ───────────────   │  │  ────────────────   │  │  ────────────────   │             │
│   │ • projects          │  │ • embeddings texto  │  │ • triplas RDF-like  │             │
│   │ • scenes (polymor.) │  │ • embeddings visual │  │ • cena → take       │             │
│   │ • takes             │  │ • embeddings áudio  │  │ • personagem → cena │             │
│   │ • characters        │  │ • busca ANN HNSW    │  │ • take → timecode   │             │
│   │ • timelines         │  │ • filtering nativo  │  │ • documento → cena  │             │
│   │ • continuity        │  │ • híbrido sparse    │  │                     │             │
│   │ • export_history    │  │                     │  │                     │             │
│   └─────────────────────┘  └─────────────────────┘  └─────────────────────┘             │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────┐       │
│   │                    ARMAZENAMENTO DE MÍDIA                                   │       │
│   │   • Originais: NAS/local storage (preservados)                              │       │
│   │   • Proxies: H.264 720p CRF 23 (edição/preview)                             │       │
│   │   • Cache de análise: frames extraídos, embeddings, transcrições            │       │
│   └─────────────────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  INFRAESTRUTURA                                                                         │
│   • Docker + NVIDIA Container Toolkit (GPU)                                             │
│   • Watch folder 24/7 (inotify/systemd)                                                 │
│   • Message queue para jobs (Redis/RQ ou Celery)                                        │
│   • API REST (FastAPI) com documentação OpenAPI                                         │
│   • Frontend: React/Vue.js + Video.js + D3.js (timeline)                                │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Princípios Arquiteturais

1. **Plugin-based activation:** Cada módulo do motor pode ser ativado ou desativado por perfil de projeto. Um projeto de TV não precisa de análise de match-on-action; um documentário não precisa de alinhamento com roteiro.
2. **Schema polimórfico:** A entidade "cena" tem campos comuns (id, timecodes, status) e campos específicos por perfil, armazenados como JSON/JSONB no SQLite ou em tabelas especializadas.
3. **Pipeline assíncrono:** Ingest e análise multimodal são jobs em background (Redis/RQ), não bloqueiam a API. O usuário submete o job e recebe notificações de progresso.
4. **Decision Engine desacoplado:** A lógica editorial é implementada como uma camada de "strategy pattern" — cada perfil tem seu próprio conjunto de regras e heurísticas que operam sobre os mesmos dados estruturados.

---

## 4. Schema de Dados Recomendado

O schema proposto usa **SQLite** como banco principal, com **campos polimórficos** para acomodar os três perfis sem rigidez. A entidade central é `scene`, que tem atributos comuns a todos os perfis e atributos específicos armazenados em JSON.

### 4.1 Entidades Principais

```sql
-- Projeto (contém o perfil e configurações)
CREATE TABLE project (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    profile TEXT CHECK(profile IN ('fiction', 'documentary', 'tv_news')) NOT NULL,
    status TEXT DEFAULT 'active',
    config_json TEXT,           -- configurações específicas do projeto
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cena (entidade polimórfica — significado muda por perfil)
CREATE TABLE scene (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES project(id),
    
    -- Campos COMUNS a todos os perfis
    scene_type TEXT,            -- 'scripted', 'interview', 'verite', 'archive', 'news_block', etc.
    title TEXT,
    description TEXT,
    status TEXT CHECK(status IN ('draft','ingested','analyzed','in_edit','approved')),
    duration_target INTEGER,    -- duração alvo em segundos (null se não aplicável)
    location TEXT,
    date_filmed DATE,
    
    -- Campos POLIMÓRFICOS (JSON — preenchidos conforme perfil)
    fiction_data TEXT,          -- JSON: location_ext_int, time_of_day, characters_script[], dialogues[]
    documentary_data TEXT,      -- JSON: themes[], interviewees[], revelation_score, sincerity_score
    tv_news_data TEXT,         -- JSON: hierarchy, lead_text, source_type, urgency, air_time
    
    -- Metadados técnicos
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Takes (clip de vídeo bruto)
CREATE TABLE take (
    id INTEGER PRIMARY KEY,
    scene_id INTEGER REFERENCES scene(id),
    project_id INTEGER REFERENCES project(id),
    
    -- Identificação
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    hash TEXT UNIQUE,           -- deduplicação
    
    -- Timecodes
    tc_in TEXT,                 -- timecode de entrada (HH:MM:SS:FF)
    tc_out TEXT,
    duration REAL,
    
    -- Metadados técnicos (extraídos via FFprobe)
    codec TEXT,
    resolution TEXT,
    fps REAL,
    camera TEXT,
    lens TEXT,
    iso INTEGER,
    shutter TEXT,
    gps_lat REAL,
    gps_lon REAL,
    
    -- Análise
    quality_score REAL,         -- qualidade técnica (foco, exposição)
    emotion_dominant TEXT,      -- emoção predominante detectada
    characters_detected TEXT,   -- JSON: lista de personagens/falantes identificados
    
    -- Status editorial
    status TEXT CHECK(status IN ('raw','approved','rejected','alternate')),
    notes TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Personagens / Falantes (unificados across perfis)
CREATE TABLE person (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES project(id),
    name TEXT NOT NULL,
    person_type TEXT CHECK(person_type IN ('actor','interviewee','authority','real_person')),
    
    -- Dados para reconhecimento facial
    face_embedding BLOB,        -- vetor de embedding facial
    face_reference_photo TEXT,  -- path para foto de referência
    
    -- Dados por perfil
    fiction_data TEXT,          -- JSON: character_name_script, role, description
    doc_data TEXT,              -- JSON: real_name, bio, occupation
    tv_data TEXT,               -- JSON: title, position, organization, lower_third_text
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transcrição (palavra-a-palavra com timestamps)
CREATE TABLE transcript (
    id INTEGER PRIMARY KEY,
    take_id INTEGER REFERENCES take(id),
    
    word TEXT,
    start_time REAL,            -- em segundos
    end_time REAL,
    speaker_id INTEGER REFERENCES person(id),
    confidence REAL,
    
    -- Índice para busca
    FULLTEXT INDEX (word)       -- FTS5 do SQLite
);

-- Continuidade (específico para ficção)
CREATE TABLE continuity (
    id INTEGER PRIMARY KEY,
    scene_id INTEGER REFERENCES scene(id),
    take_from INTEGER REFERENCES take(id),
    take_to INTEGER REFERENCES take(id),
    
    continuity_type TEXT CHECK(continuity_type IN ('match_on_action','eyeline','prop','costume','lighting')),
    score REAL,                 -- qualidade da continuidade (0-1)
    matched_at REAL,            -- timestamp do match
    notes TEXT
);

-- Timeline (edição — universal)
CREATE TABLE timeline (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES project(id),
    name TEXT,
    version INTEGER DEFAULT 1,
    
    -- Sequência de clips (JSON array ordenado)
    sequence_json TEXT,         -- [{take_id, in, out, transition, notes}, ...]
    
    -- Metadados da edição
    total_duration REAL,
    editor_notes TEXT,
    status TEXT CHECK(status IN ('draft','approved','exported')),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Documentos de produção (roteiro, diárias, etc.)
CREATE TABLE production_doc (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES project(id),
    
    doc_type TEXT CHECK(doc_type IN ('script','shooting_schedule','daily_report','treatment','storyboard','pauta','teleprompter')),
    filename TEXT,
    filepath TEXT,
    parsed_content TEXT,        -- conteúdo extraído/parsed
    parsed_metadata TEXT,       -- JSON: metadados estruturados
    
    -- Link com cenas (muitos-para-muitos via scene_doc)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Grafo de relações (RDF-like em SQLite)
CREATE TABLE relation (
    id INTEGER PRIMARY KEY,
    subject_type TEXT,          -- 'scene', 'take', 'person', 'doc'
    subject_id INTEGER,
    predicate TEXT,             -- 'uses', 'features', 'documents', 'approves', 'matches'
    object_type TEXT,
    object_id INTEGER,
    weight REAL DEFAULT 1.0,    -- confiança da relação
    metadata TEXT,              -- JSON extra
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4.2 Índices e Otimizações

```sql
-- Índices para performance
CREATE INDEX idx_take_scene ON take(scene_id);
CREATE INDEX idx_take_hash ON take(hash);
CREATE INDEX idx_transcript_take ON transcript(take_id);
CREATE INDEX idx_transcript_time ON transcript(start_time, end_time);
CREATE INDEX idx_relation_subject ON relation(subject_type, subject_id);
CREATE INDEX idx_relation_object ON relation(object_type, object_id);
CREATE INDEX idx_scene_project ON scene(project_id);

-- FTS5 para busca full-text em transcrições
CREATE VIRTUAL TABLE transcript_fts USING fts5(
    content=transcript,
    content_rowid=id,
    word
);
```

### 4.3 Representação da "Cena" nos Três Perfis

| Aspecto | Ficção | Documentário | TV/Jornalismo |
|:---|:---|:---|:---|
| **Identidade** | EXT. PARQUE - DIA #12 | Entrevista: João Silva — Seca 2012 | Matéria: Coletiva Ministério — 1min30 |
| **Vínculo** | Roteiro (cabeçalho de cena) | Tema/treatment | Pauta da redação |
| **Atributos core** | localização, época, personagens, diálogos | tema(s), entrevistado(s), data do fato, emoção | hierarquia, lead, fonte, urgência |
| **Status de vida** | Roteirizada → Filmada → Em edição → Aprovada | Coletada → Transcrita → Indexada → Em estrutura → Aprovada | Pautada → Filmada → Editada → Aprovada → No ar |
| **Métrica de qualidade** | Cobertura (planos/takes), continuidade, performance | Índice de revelação, sinceridade emocional, B-roll | Precisão factual, duração exata, clareza |
| **Campos JSON** | `fiction_data` | `documentary_data` | `tv_news_data` |

---

## 5. Papers Acadêmicos Relevantes

A literatura sobre edição automática de vídeo com input narrativo está crescendo rapidamente. Abaixo, os trabalhos mais relevantes organizados por área.

### 5.1 Edição Automática com Entendimento Narrativo Multimodal

| Ano | Título | Autores | Conferência | Link | Relevância |
|:---|:---|:---|:---|:---|:---|
| 2025 | **From Long Videos to Engaging Clips: A Human-Inspired Video Editing Framework with Multimodal Narrative Understanding** | Diversos (industry paper) | EMNLP 2025 Industry | [^41^][^44^] | **Alta** — framework completo com extração de personagens, análise de diálogo, matching personagem-diálogo, segmentação de cenas, e memory module para vídeos longos |
| 2026 | **AutoCut: End-to-End Advertisement Video Editing Based on Multimodal Tokenization** | Diversos | arXiv 2026 | [^48^] | **Alta** — tokenização unificada de script, frames e áudio; alinhamento multimodal + SFT para seleção e ordenação de clips |
| 2021 | **Learning to Cut by Watching Movies** | Pardo et al. | ICCV 2021 | [^41^] | **Alta** — aprende padrões de corte de filmes profissionais; fundamental para perfil Ficção |
| 2023 | **AutoShot: A Short Video Dataset and State-of-the-Art Shot Boundary Detection** | Zhu et al. | CVPR 2023 | [^41^] | Média — detecção de boundaries entre shots, usável para segmentação |
| 2024 | **TransNetV2: An Effective Deep Network Architecture for Fast Shot Transition Detection** | Soucek & Lokoc | ACM MM 2024 | [^41^] | Média — detecção de transições de plano |

### 5.2 Diarização e Análise de Fala

| Ano | Título | Autores | Conferência | Link | Relevância |
|:---|:---|:---|:---|:---|:---|
| 2025 | **SpeakerLM: End-to-End Versatile Speaker Diarization and Recognition with Multimodal Large Language Models** | Diversos | arXiv 2025 | [^20^] | **Alta** — modelo end-to-end unificado para diarização + reconhecimento de falante |
| 2026 | **DM-ASR: Diarization-aware Multi-speaker ASR with Large Language Models** | Diversos | arXiv 2026 | [^19^] | **Alta** — ASR com diarização integrada usando LLMs |
| 2025 | **TellWhisper: Tell Whisper Who Speaks When** | Diversos | arXiv 2025 | [^24^] | Média — integra Whisper com diarização para transcrição atribuída |
| 2024 | **Hybrid-Diarization System with Overlap Post-Processing for DISPLACE 2024** | Pirlogeanu et al. | Interspeech 2024 | [^22^] | Média — sistema híbrido com pós-processamento de overlap |

### 5.3 Bancos de Dados Vetoriais e Busca Semântica

| Ano | Título | Autores | Fonte | Link | Relevância |
|:---|:---|:---|:---|:---|:---|
| 2024 | **Vector Database Comparison** (benchmarks Qdrant/ChromaDB/Milvus/Weaviate) | Clore.ai | Blog técnico | [^3^] | **Alta** — benchmarks de performance reais com 1M e 10M vetores |
| 2025 | **Self-Improving LLM Architectures with Open Source** (ChromaDB vs Qdrant vs Weaviate) | Rohan Paul | Blog | [^14^] | Média — comparação prática para sistemas RAG locais |

### 5.4 Sincronização de Áudio-Vídeo

| Tema | Descrição | Relevância |
|:---|:---|:---|
| Sync por waveform | Algoritmo de cross-correlation + MFCC para alinhamento de áudio é bem estabelecido; implementações em librosa, scipy | **Alta** — base para sync sem timecode |
| PluralEyes (descontinuado) | Referência de UX para sync automático; pattern de "arrastar tudo e clicar sync" | Média — inspiração de interface |

---

## 6. Gaps Técnicos que Exigirão Desenvolvimento Customizado

A análise das 27 perguntas revelou **8 gaps técnicos** que não têm solução pronta e exigirão investimento de engenharia significativo:

### Gap 1: Detecção de Continuidade Automática (Match-on-Action, Eyeline Match)

**Descrição:** Não existe biblioteca open source para detecção automática de continuidade visual entre takes (match-on-action, eyeline match, continuidade de prop/costume). É um problema de Computer Vision ativo na academia mas com pouca aplicação prática disponível.

**Complexidade:** Alta  
**Estratégia:** Implementar heurísticas baseadas em: (1) **optical flow** entre frames finais/iniciais de takes consecutivos, (2) **posição/direção do olhar** (InsightFace), (3) **posição de objetos** (YOLOv8 + tracking). Usar como scoring inicial, não como decisão final.

### Gap 2: Fuzzy Matching Roteiro-Transcrição com Improvisos

**Descrição:** Alinhar transcrição Whisper com diálogo de roteiro quando há improvisos, hesitações, erros de fala, e repetições. Edit distance simples falha nesses casos.

**Complexidade:** Alta  
**Estratégia:** Pipeline em múltiplas camadas: (1) **embedding semântico** (BERTimbau para PT-BR) para matching a nível de sentença, (2) **Levenshtein normalizado** para matching palavra-a-palavra, (3) **heurísticas de contexto** (mesma cena, mesmos personagens, proximidade de timecode), (4) **LLM como juiz final** para casos ambíguos.

### Gap 3: Corte por Duração Fixa com Preservação Semântica

**Descrição:** Reduzir uma matéria para duração exata (ex: 1min30) removendo pausas e hesitações, sem perder o lead ou a informação principal.

**Complexidade:** Alta  
**Estratégia:** Algoritmo de "shrinking" hierárquico: (1) pontuar cada segmento por **importância informativa** (usando LLM ou TF-IDF sobre o tema), (2) remover segmentos de menor pontuação primeiro, (3) dentro de segmentos, remover pausas e hesitações, (4) iterar até atingir a duração alvo.

### Gap 4: Busca Semântica em Tempo Real em 500+ Horas

**Descrição:** Busca por "cena onde Maria está triste na cozinha" em um acervo de 500+ horas com latência <1s.

**Complexidade:** Média-Alta  
**Estratégia:** (1) **Indexação por projeto** (não global), (2) **cache de embeddings** no Qdrant, (3) **BM25 híbrido** para pré-filtragem rápida, (4) **quantização int8** para reduzir memória, (5) ** pré-computar embeddings** de todos os segmentos durante o ingest (não em tempo de query).

### Gap 5: Sincronização Áudio-Vídeo sem Timecode (Documentário)

**Descrição:** Sync automático entre gravações de áudio externas (Zoom) e vídeo de câmera sem timecode compartilhado.

**Complexidade:** Média  
**Estratégia:** Implementar **cross-correlation de MFCC** entre áudio da câmera (guide track) e áudio externo. Usar `librosa.feature.mfcc` + `scipy.signal.correlate`. Para múltiplos takes, detectar silêncios como boundaries e fazer sync por segmento.

### Gap 6: Lower Thirds Automáticos com Templates

**Descrição:** Gerar lower thirds burned-in a partir de templates da emissora, com nome/cargo do falante.

**Complexidade:** Média  
**Estratégia:** Engine de templates usando **Pillow** para composição de imagens + **FFmpeg drawtext/drawbox** para overlay em vídeo. Templates definidos como JSON (posição, fonte, cor, animação). Pré-gerar imagens PNG com transparência e composite via FFmpeg.

### Gap 7: Transcrição Streaming para Teleprompter (<1s latência)

**Descrição:** Transcrever fala em tempo real com latência suficientemente baixa para alimentar um teleprompter ao vivo.

**Complexidade:** Média  
**Estratégia:** **faster-whisper** com chunks de 1-2 segundos + VAD (Silero-VAD) para detecção de fala. Latência estimada: 1-3s. Se necessário latência <500ms, usar **API comercial** (AssemblyAI streaming a ~200ms) como fallback.

### Gap 8: Gestão de Consentimento para Dados Biométricos (LGPD)

**Descrição:** Garantir conformidade com LGPD para processamento de dados faciais/emocionais de não-atores.

**Complexidade:** Média  
**Estratégia:** (1) **Hash irreversível** de embeddings faciais (não armazenar imagens), (2) **flag de consentimento** por pessoa no banco de dados, (3) **auto-anonimização** de faces sem consentimento (blur ou substituição), (4) **Relatório de Impacto (RIAD/LIA)** documentado, (5) controle de acesso rigoroso aos dados.

---

## 7. Roadmap de Implementação Sugerido

O roadmap é dividido em **5 fases**, com entregáveis incrementais e crescente complexidade. Cada fase tem duração estimada e dependências claras.

| Fase | Nome | Duração | Entregáveis | Dependências |
|:---|:---|:---|:---|:---|
| **Fase 0** | **POC Técnico** | 4-6 semanas | • Ingest de um formato (.mp4/.mov)  
• Transcrição WhisperX funcionando  
• Extração de metadados FFprobe  
• SQLite schema básico  
• Um exporter (OTIO ou Kdenlive) | Nenhuma |
| **Fase 1** | **MVP Ficção** | 8-10 semanas | • Parser Fountain/FDX integrado  
• Alinhamento básico roteiro-transcrição  
• Interface de roteiro interativo (web)  
• Detecção de cobertura (planos presentes/ausentes)  
• Export EDL/XML/OTIO  
• Formulário de intenção básico | Fase 0 |
| **Fase 2** | **MVP Documentário** | 8-10 semanas | • Parser de treatment e logs  
• Busca semântica em transcrições (Qdrant)  
• Sugestão de B-roll por proximidade semântica  
• Sincronização áudio externo (sem timecode)  
• Índice de "sinceridade emocional" básico  
• Detecção de furos narrativos | Fase 1 |
| **Fase 3** | **MVP Jornalismo TV** | 8-10 semanas | • Ingest multi-fonte (FTP, WhatsApp)  
• Transcrição streaming (modo chunked)  
• Corte por duração fixa (algoritmo de shrink)  
• Geração de lower thirds  
• Template de programa  
• Integração com Superdesk (referência NRCS) | Fase 1 |
| **Fase 4** | **Integração & Escalabilidade** | 6-8 semanas | • Plugin system completo  
• Containerização Docker com GPU  
• API REST completa com documentação  
• Sistema de plugins para parsers e modelos  
• Otimização de performance (proxy, cache)  
• Testes de carga e estabilidade | Fases 1-3 |

### Cronograma Visual

```
Semanas:  1-6      7-16     17-26    27-36    37-44
          ├────────┼────────┼────────┼────────┤
Fase 0:   [  POC   ]
Fase 1:            [    MVP Ficção    ]
Fase 2:                     [   MVP Documentário   ]
Fase 3:                              [   MVP TV/Jornalismo  ]
Fase 4:                                       [  Integração  ]
```

**Total estimado:** 8-10 meses para versão completa com os três perfis.

---

## 8. Recomendação de Stack Final

### 8.1 Stack Completo por Categoria

| Categoria | Tecnologia Principal | Alternativa | Justificativa |
|:---|:---|:---|:---|
| **Linguagem** | Python 3.10+ | — | Ecossistema dominante em ML/CV; todas as libs principais são Python-first |
| **API/Backend** | FastAPI | Flask | Performance, async nativo, documentação OpenAPI automática, tipagem |
| **Banco estruturado** | SQLite | PostgreSQL | Zero config, serverless, suficiente para escala do CapIAu-Talho; migração para PostgreSQL é trivial se necessário |
| **Busca semântica** | Qdrant (Docker) | Weaviate | Melhor performance self-hosted, menor footprint, filtering nativo, Apache 2.0 |
| **Grafo de relações** | SQLite (triplas) | Neo4j | Para a escala do CapIAu-Talho, triplas em SQLite são suficientes; evita infra adicional |
| **Message Queue** | Redis + RQ | Celery + RabbitMQ | Simplicidade para jobs em background; RQ é Python-native e suficiente |
| **Transcrição** | WhisperX | faster-whisper | WhisperX = transcrição + diarização + timestamps palavra; one-stop shop |
| **VLM (descrição)** | Qwen2-VL-2B | Qwen2.5-VL-3B | 2B cabe em RTX 4060 com VRAM sobrando; Apache 2.0; excelente multimodal |
| **LLM local** | Qwen2.5-7B Q4 | Mistral-Nemo-12B Q4 | Apache 2.0, excelente PT-BR, cabe em 8GB, ~9 t/s; alternativa se VRAM permitir |
| **Detecção objetos** | YOLOv8 | YOLOv11 | Maduro, rápido, documentação excelente; AGPL (compatível com uso interno) |
| **Reconhecimento facial** | InsightFace | DeepFace | Mais preciso; DeepFace como fallback para emoções |
| **OCR** | EasyOCR | PaddleOCR | Fácil instalação, suporta PT-BR, GPU-accelerated |
| **Proxy** | FFmpeg H.264 | — | Padrão da indústria, trivial de automatizar |
| **Containerização** | Docker + NVIDIA Toolkit | — | Padrão para GPU workloads |
| **Frontend** | React + Video.js | Vue + Plyr | Ecossistema maduro; Video.js tem suporte a plugins e HLS |
| **Timeline visual** | D3.js + custom | — | Não existe componente pronto; D3 é a base mais flexível |
| **NRCS (referência)** | Superdesk | Cuez | Superdesk é open source (AGPL), boa referência de arquitetura NRCS |

### 8.2 Uso de VRAM no RTX 4060 8GB (Orquestração)

Com 8GB VRAM, não é possível carregar todos os modelos simultaneamente. A estratégia é **execução sequencial com unload/load dinâmico**:

| Modelo | VRAM (Q4_K_M) | Uso | Estratégia |
|:---|:---|:---|:---|
| Qwen2.5-7B | ~4.7 GB | LLM (decisões editoriais, resumos) | Carrega sob demanda; descarrega quando não em uso |
| Qwen2-VL-2B | ~3.5 GB | Descrição visual de frames | Pipeline batch: processa frames em lotes, depois descarrega |
| WhisperX (large-v3) | ~4.0 GB | Transcrição + diarização | Pipeline de ingest: processa um take por vez |
| YOLOv8 | ~1.5 GB | Detecção de objetos | Pode ficar residente (menor); ou batch |
| InsightFace | ~1.5 GB | Reconhecimento facial | Batch durante ingest |

**Observação:** O motor deve implementar um **Model Manager** que controla o ciclo de vida dos modelos na GPU — carrega o modelo necessário para o job atual, executa, e descarrega (ou deixa residente se houver VRAM disponível). Jobs são enfileirados por tipo de análise para minimizar thrashing de modelos.

### 8.3 Decisões Arquiteturais Principais

| Decisão | Escolha | Rationale |
|:---|:---|:---|
| **Motor compartilhado vs. 3 motores** | Motor único + plugin system | Elimina duplicação de código; plugins ativam/desativam módulos por perfil |
| **OTIO como formato nativo** | Sim, OTIO é o core | Universal, suportado por Resolve/Avid/Premiere, extensível, open source |
| **LLM local vs. API** | Local primário, API opcional | Privacidade de dados de produção; custo zero recorrente; funciona offline |
| **SQLite vs. PostgreSQL** | SQLite inicial | Zero infra; migração trivial quando escalar |
| **Qdrant vs. ChromaDB** | Qdrant | Produção-ready; ChromaDB é só para prototipagem |
| **WhisperX vs. AssemblyAI** | WhisperX primário, AssemblyAI fallback | WhisperX é completo e local; AssemblyAI para streaming se latência for crítica |

---

## 9. Considerações Finais

### 9.1 O Que é Viável Imediatamente

As seguintes capacidades podem ser implementadas **hoje** com stack open source maduro:

- Ingest 24/7 com deduplicação por hash
- Transcrição palavra-a-palavra com timestamps e diarização (WhisperX)
- Extração de metadados técnicos (FFprobe)
- Detecção de objetos e ações (YOLOv8)
- Reconhecimento facial e análise de emoção (InsightFace/DeepFace)
- Busca semântica em transcrições (Qdrant + embeddings)
- Parsing de roteiros Fountain e FDX
- Geração de EDL, XML, OTIO e projetos Kdenlive
- Interface web básica de preview e busca
- Containerização completa com Docker

### 9.2 O Que Requer Pesquisa e Desenvolvimento

As seguintes capacidades são **viáveis mas exigem engenharia significativa**:

- Alinhamento inteligente roteiro-transcrição com improvisos
- Detecção automática de continuidade (match-on-action)
- Corte por duração fixa com preservação semântica
- Edição assistida com justificativa editorial automatizada
- Busca semântica multimodal (texto + imagem + áudio combinados)
- Lower thirds dinâmicos com templates
- Transcrição streaming para teleprompter ao vivo

### 9.3 O Que é Ambicioso (Risco Técnico Elevado)

- Edição completamente automática sem intervenção humana
- Detecção de "sinceridade emocional" com alta precisão
- Geração automática de AAF completo para Avid
- Edição em tempo real (live cutting) durante transmissão

### 9.4 Próximos Passos Imediatos

1. **Implementar o POC Técnico** (Fase 0): ingest de um vídeo MP4, transcrição com WhisperX, extração de metadados, e export para OTIO. Isso valida o pipeline básico end-to-end.
2. **Definir o schema SQLite** completo com campos polimórficos para os três perfis.
3. **Configurar o ambiente Docker** com GPU e instalar todas as dependências principais.
4. **Testar a orquestração de modelos** na RTX 4060: confirmar que Qwen2.5-7B + WhisperX + Qwen2-VL-2B podem ser carregados sequencialmente sem OOM.
5. **Desenvolver o parser Fountain/FDX** e criar estrutura de dados unificada para cenas.

---

*Relatório gerado em 02/06/2026. Todas as informações baseadas em pesquisa de fontes públicas disponíveis em junho de 2026.*
