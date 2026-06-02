# 🎬 CapIAu — Motor de Inteligência e Decupagem Cinematográfica

O **CapIAu** é uma solução de inteligência artificial e pré-edição (decupagem) projetada especificamente para fluxos de **Making Of e Documentários**. O sistema foi projetado sob um **Modelo Híbrido Otimizado** para rodar com eficiência em CPUs locais (como processadores Intel i7 com 32GB de RAM), eliminando a dependência de GPUs Nvidia dedicadas locais através do uso de buscas locais rápidas em CPU combinadas com APIs na nuvem de baixíssimo custo.

Com o CapIAu, você pode processar mais de 20 horas de material bruto (entrevistas, B-rolls de bastidores, fotos de set), transcrever falas automaticamente com identificação de personagens (diarização), fazer pesquisas semânticas rápidas na biblioteca (ex: *"diretor escolhendo lentes"*) e exportar o rascunho de timeline diretamente para Premiere Pro ou DaVinci Resolve via XML e OpenTimelineIO.

---

## 🛠️ Arquitetura Técnica do Sistema

A arquitetura do CapIAu é baseada em três pilares: **Ingestão In-Place (HD Externo)**, **Banco de Dados Híbrido Local** e **Processamento de IA Híbrido**:

```mermaid
graph TD
    subgraph HD_Externo["💾 HD Externo / SSD"]
        Originals["Vídeos Originais (.mp4 / .mov / .mxf)"]
    end

    subgraph Backend["🐍 FastAPI Backend (Python / CPU Local)"]
        Watcher["Watcher / Ingestor (os.walk)"]
        FFmpeg["FFmpeg (Geração de Proxies & MP3 Leve)"]
        SQLite["SQLite (Metadados, Falas & Timelines)"]
        SentenceTransformers["Sentence-Transformers (MiniLM CPU)"]
        Qdrant["Qdrant Local (File-based CPU)"]
    end

    subgraph APIs_Nuvem["☁️ APIs na Nuvem (Econômicas)"]
        AssemblyAI["AssemblyAI (ASR / Diarização pt-BR)"]
        OpenRouterText["OpenRouter (DeepSeek V3 — Clustering)"]
        OpenRouterVision["OpenRouter (Gemini 2.5 Flash — Descrição de Frames)"]
    end

    subgraph Frontend["💻 Frontend Web (Glassmorphism UI)"]
        Player["Player 16:9 (JKL Shortcuts / Marcadores I-O)"]
        Biblioteca["Biblioteca em Árvore (In-Place)"]
        Timeline["Timeline Multi-Trilha (Cortes)"]
        FilaTarefas["Tarefas (Progresso FFmpeg/ASR)"]
    end

    Originals --> Watcher
    Watcher --> SQLite
    Watcher --> FFmpeg
    FFmpeg -->|Proxy 720p| Player
    FFmpeg -->|Mono MP3 16kHz| AssemblyAI
    AssemblyAI -->|Diarização + Timestamps| SQLite
    AssemblyAI -->|Indexar texto| SentenceTransformers
    SentenceTransformers -->|Embeddings| Qdrant
    SQLite -->|Diálogos| OpenRouterText
    OpenRouterText -->|Temas Narrativos| SQLite
    FFmpeg -->|Frames de Bastidores| OpenRouterVision
    OpenRouterVision -->|Descrições Visuais| Qdrant
    Qdrant -->|Busca Semântica < 5ms| Biblioteca
    Timeline -->|Exportar XML/OTIO| HD_Externo
```

### 1. Camada de Dados e Busca Vetorial (Local em CPU)
* **SQLite (`capiau.db`):** Banco de dados relacional que gerencia metadados técnicos de mídias, timelines, relações e a tabela de falas palabra-a-palavra. Conta com deleção em cascata (`PRAGMA foreign_keys = ON`) para o isolamento completo de múltiplos projetos.
* **Qdrant Local (File-Based):** Banco vetorial embutido que opera localmente em CPU (sem necessidade de Docker) para armazenar os embeddings e realizar buscas semânticas instantâneas em milissegundos.
* **Sentence-Transformers (`all-MiniLM-L6-v2`):** Modelo local e offline de ~120MB encarregado de gerar os embeddings vetoriais na CPU.

### 2. Camada de Processamento de Mídia
* **FFmpeg / FFprobe:** Extrai metadados técnicos (duração, codec, resolução, taxa de quadros) na importação e converte vídeos pesados H.264/ProRes em proxies leves 720p/360p H.264 AAC com monitoramento em tempo real do progresso (0-100%).
* **Extração Monofônica Local:** Antes de transcrever na nuvem, o CapIAu extrai o áudio em MP3 mono de 16kHz localmente. Isso reduz o tamanho do arquivo a ser enviado à nuvem em mais de 99%, evitando falhas de rede e permitindo carregar o áudio de entrevistas de 30 minutos em menos de 10 segundos.

### 3. Camada de Inteligência Artificial (Nuvem Econômica)
* **AssemblyAI (Universal-2 API):** Transcreve depoimentos na língua portuguesa com pontuação e diarização automática de personagens (quem falou o quê e em qual tempo exato).
* **OpenRouter (DeepSeek V3 & Gemini 2.5/3.1 Flash):**
  * **DeepSeek V3:** Agrupa as falas de todas as entrevistas em temas de documentário (clustering narrativo).
  * **Gemini 2.5 Flash / Gemini 3.1 Flash Lite:** Analisa fotos de set e frames de B-roll a cada 10 segundos para gerar metadados visuais semânticos de bastidores.

---

## 📂 Estrutura Modular do Código

O projeto está organizado seguindo práticas de modularidade para facilitar expansões futuras:

```
├── data/                       # Arquivos gerados localmente (ignorado no Git)
│   ├── cache/                  # Áudios MP3 temporários para upload ASR
│   ├── originals/              # Mídias copiadas fisicamente (se copy_original=True)
│   ├── proxies/                # Vídeos proxies leves MP4 gerados pelo FFmpeg
│   ├── capiau.db               # Banco de dados relacional SQLite
│   └── qdrant.db/              # Base vetorial local do Qdrant
├── scratch/                    # Scripts rápidos e ferramentas de teste de conexão
│   └── test_connections.py     # Script utilitário de diagnóstico das APIs
├── src/                        # Código-fonte principal da aplicação
│   ├── api/
│   │   └── server.py           # Rotas FastAPI e silenciador de log de polling
│   ├── db/
│   │   ├── schema.py           # Definição e inicialização do SQLite
│   │   └── operations.py       # Operações CRUD do banco de dados e isolamento
│   ├── export/
│   │   └── otio_export.py      # Conversor de Timeline para XML (Resolve/Premiere)
│   ├── ingest/
│   │   └── watcher.py          # Watcher de arquivos, FFprobe e gerador de proxies
│   ├── nlp/
│   │   └── theme_cluster.py    # Clustering inteligente de falas via DeepSeek V3
│   ├── search/
│   │   └── semantic.py         # Busca vetorial local via Qdrant e MiniLM
│   ├── transcription/
│   │   └── asr_engine.py       # Extração de MP3 e integração com AssemblyAI
│   ├── ui/                     # Interface Web Premium (Glassmorphism)
│   │   ├── index.html          # HTML5 semântico com abas e player widescreen
│   │   ├── app.js              # Atalhos JKL, I/O, in-place updates e persistência
│   │   └── styles.css          # Estilo translúcido premium responsivo
│   ├── vision/
│   │   └── multimodal_engine.py# Análise visual de fotos e frames via Gemini
│   └── config.py               # Configurações globais e inicialização de pastas
├── tests/                      # Conjunto de testes de integração e unitários
│   ├── test_database.py        # Validação do SQLite e busca semântica em CPU
│   └── test_hybrid_pipeline.py # Validação de ingestão e fluxo de proxies
├── .env                        # Variáveis de ambiente e API Keys (não comitar!)
├── .gitignore                  # Regras de exclusão do Git
├── requirements.txt            # Dependências unificadas do Python
└── USER_MANUAL.md              # Manual de utilização para o usuário final
```

---

## ⚡ Instalação e Execução Local

### Pré-requisitos:
1. **Python 3.10+** instalado.
2. **FFmpeg** instalado na máquina e adicionado ao PATH do Windows. (Verifique abrindo o console e digitando `ffmpeg -version`).

### Configuração:
1. **Instalar dependências:**
   ```bash
   pip install -r requirements.txt
   ```
2. **Configurar as APIs no arquivo `.env`:**
   Crie ou edite o arquivo `.env` na raiz do projeto com as chaves corretas:
   ```env
   OPENROUTER_API_KEY=sua_chave_do_openrouter
   ASSEMBLYAI_API_KEY=sua_chave_da_assemblyai
   
   # Opcional: Modelos OpenRouter (Gemini 2.5 Flash / DeepSeek V3)
   TEXT_MODEL=deepseek/deepseek-chat
   VISION_MODEL=google/gemini-2.5-flash
   ```

### Executar a aplicação:
1. Inicie o servidor FastAPI:
   ```bash
   python -m uvicorn src.api.server:app --reload
   ```
2. Acesse a URL no navegador:
   👉 **[http://localhost:8000/](http://localhost:8000/)**

---

## 🐙 Gerenciamento com Git e GitHub

Como a pasta local ainda não está rastreada por controle de versão, siga as etapas abaixo no terminal do seu computador para inicializar e publicar o repositório no seu GitHub.

### Passo 1: Inicializar o repositório local
1. Abra o prompt de comando no diretório do projeto:
   ```powershell
   cd c:\Users\FGC\Desktop\Capiau-Talho-Kimi_MVP
   ```
2. Inicialize o repositório Git:
   ```bash
   git init
   ```

### Passo 2: Commitar as bases de código modulares
Adicione os arquivos respeitando as regras do `.gitignore` (que ignoram as mídias pesadas e bancos locais para não exceder limites de tamanho de arquivo do GitHub):
```bash
git add .
git commit -m "feat: setup do MVP CapIAu funcional com proxies in-place, ASR, busca semântica em CPU e correções de usabilidade"
```

### Passo 3: Criar repositório remoto no GitHub e fazer o Push
1. Acesse o seu [GitHub](https://github.com/) e crie um novo repositório vazio (ex: `Capiau-Talho-Kimi_MVP`). **Não** adicione README, licença ou gitignore automáticos na interface do site.
2. Copie o endereço HTTPS ou SSH do repositório gerado e rode os comandos abaixo no seu computador:
   ```bash
   # Renomear branch padrão para main
   git branch -M main
   
   # Conectar o repositório local com o GitHub remoto
   git remote add origin https://github.com/SEU_USUARIO/Capiau-Talho-Kimi_MVP.git
   
   # Fazer o envio definitivo do código
   git push -u origin main
   ```

---

## ☁️ Instruções de Deploy (Vercel & Produção)

### Cenário 1: Hospedar o Frontend na Vercel (Recomendado para Interface)
O frontend estático está localizado em `src/ui/`. A Vercel é excelente para servir páginas estáticas de forma gratuita e rápida.

1. Instale a Vercel CLI ou conecte seu repositório do GitHub diretamente no site da [Vercel](https://vercel.com).
2. Configure a raiz do projeto de deploy direcionado para `src/ui` (ou configure as configurações padrão para servir arquivos HTML estáticos).
3. **Desvantagem local:** O player Web local precisa acessar as rotas de API `/api/...` que rodam na sua máquina (FastAPI).

### Cenário 2: Servidor Completo (FastAPI + Frontend)
Hospedar o backend FastAPI na Vercel requer configurar um arquivo `vercel.json` na raiz do repositório para mapear requisições do servidor FastAPI como Serverless Functions.

#### Exemplo de `vercel.json`:
```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/src/api/server.py" },
    { "source": "/(.*)", "destination": "/src/ui/$1" }
  ]
}
```

> [!CAUTION]
> **Aviso de Limitações de Cloud (Vercel/Render):**
> Hospedar a aplicação 100% na nuvem (como na Vercel) para um MVP de vídeo possui **3 restrições técnicas graves**:
> 1. **Execução do FFmpeg:** Servidores serverless como o Vercel não possuem binários do `ffmpeg` pré-instalados para gerar proxies locais, e as funções expiram em no máximo 10-60 segundos (causando timeout em processamento de vídeo).
> 2. **Espaço em Disco:** HDs Externos e mídias de 20 horas não podem ser acessados pela Vercel em nuvem (ingestão in-place só funciona localmente na rede física do usuário).
> 3. **Bancos Embutidos:** SQLite e Qdrant Local File-Based gravam dados em arquivos locais. Em plataformas como a Vercel ou Heroku, o sistema de arquivos é **efêmero** (tudo é apagado a cada novo deploy ou reinício de servidor).
>
> **Estratégia Recomendada para Produção Remota:**
> Se desejar acessar o CapIAu de outros computadores em nuvem, configure:
> * **Banco de Dados Remoto:** SQLite no Render/Railway com volume persistente (Disk), ou migrar para PostgreSQL na nuvem + Qdrant Cloud (Instância de nuvem gratuita).
> * **Geração de Proxies no Cliente/Servidor Dedicado:** Um servidor com Docker dedicado que possua FFmpeg instalado em uma máquina com GPU (ex: AWS EC2 ou Railway com volume) para computar os proxies.

---

## 🔮 Roadmap: Futuras Fases do Projeto

Após a validação bem-sucedida do MVP com proxies e buscas, as próximas etapas de desenvolvimento do CapIAu contemplam:

1. **Edição Baseada em Texto (Text-Based Video Editing):**
   * Permitir que o editor monte a timeline apenas selecionando linhas de texto da transcrição. O sistema cortará o vídeo automaticamente nos marcadores de tempo das palavras selecionadas.
2. **Integração Nativa DaVinci Resolve / Premiere (FCPXML/OTIO completo):**
   * Aprimorar o exportador para gerar metadados de marcadores coloridos de falas diretamente nos clipes na timeline de edição profissional.
3. **Subtítulo Inteligente Integrado:**
   * Geração e gravação física (*burn-in*) ou exportação de arquivos de legenda SRT/VTT a partir dos blocos da diarização gerados pela AssemblyAI.
4. **Painel de Controle de Custos:**
   * Gráficos em tempo real do uso do OpenRouter para monitorar o gasto exato em centavos de cada clipe ou frame analisado.
