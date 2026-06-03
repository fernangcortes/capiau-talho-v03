# CaIAu Talho MVP: APIs de Baixo Custo + Free Tier Generoso

**Data:** 02/06/2026  
**Escopo:** Guia passo a passo para implementar o MVP do CaIAu Talho usando APIs pagas de **baixíssimo custo** e **free tiers generosos**. Foco em ficção cinematográfica. Zero instalação de modelos locais pesados — tudo via API. Orçamento alvo: **$0-12 para 20h de análise de vídeo** (ou $0 se usar apenas free tiers).  
**Tempo estimado:** 2-3 horas de setup + 20h de vídeo analisadas em ~4-6 horas (processamento paralelo via APIs).

---

## TL;DR — O Que Você Vai Ter em 3 Horas

Um pipeline funcional que usa **APIs de terceiros** para todo o processamento de IA — sem instalar modelos locais, sem gerenciar VRAM, sem Docker complexo. Você paga **$0.15 por hora de transcrição** (AssemblyAI) e **$0.28 por milhão de tokens de LLM** (DeepSeek). Para 20h de vídeo, o custo total fica entre **$0** (usando apenas free tiers) e **$12** (usando APIs pagas para tudo). A infraestrutura é um único servidor Python + SQLite + LiteLLM como proxy. O setup é 3x mais rápido que a versão local porque não precisa baixar modelos de 5-10GB.

---

## 1. Free Tiers Disponíveis (Junho 2026)

![Free Tiers e Custos](mvp_custo_20h.png)

### 1.1 Resumo dos Free Tiers

| Provedor | Serviço | Free Tier | Duração | Equivale a |
|:---|:---|:---|:---|:---|
| **DeepSeek** | LLM API | **5M tokens** | Uso único (signup) | ~50h de análise textual |
| **Groq** | LLM inference | **14.4K reqs/dia, 6K TPM** | Recorrente | ~20h de processamento LLM/mês |
| **ElevenLabs** | STT (Scribe v2) | **10K créditos/mês** | Recorrente | ~35h de transcrição/mês |
| **AssemblyAI** | STT Universal-2 | **$50 crédito** | Uso único | ~**185h de transcrição** |
| **Deepgram** | STT Nova-2 | **$200 crédito** | Uso único | ~770h de transcrição |
| **OpenAI** | API geral | **$5 crédito** | Uso único | Backup/emergência |
| **Together AI** | LLM inference | **$5 crédito** | Uso único | Backup LLM |
| **Cloudflare** | AI Gateway | **100K requests/mês** | Recorrente | Proxy + caching gratuito |
| **LiteLLM** | Proxy/ Router | **Ilimitado** | Sempre | Gateway self-hosted gratuito |
| **Qdrant** | Vector DB | **1M vetores cloud** | Sempre | Busca semântica |

### 1.2 Estratégia de Free Tier para 20h de Vídeo

Para processar **20h de vídeo sem pagar nada**, a estratégia é:

| Etapa | Provedor Free | Capacidade Free | Cobre 20h? |
|:---|:---|:---|:---|
| **Transcrição** | AssemblyAI ($50) + Deepgram ($200) | **~950h total** | Sim (sobra muito) |
| **LLM (análise)** | DeepSeek (5M tokens) + Groq (14.4K/dia) | **~15M tokens** | Sim |
| **LLM (classificação)** | Groq Llama 3.1 8B | 14.4K reqs/dia | Sim |
| **Visão (descrição)** | **Não existe free tier generoso** | — | **Usar local ou GPT-4o ($5)** |
| **Busca semântica** | Qdrant Cloud (1M vetores) | Ilimitado | Sim |
| **Total pago** | | | **$0-5** |

---

## 2. Arquitetura do MVP com APIs

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     CAPIAU MVP — APIs DE BAIXO CUSTO                    │
│               Zero modelos locais | Free tier + $0.15/h STT            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────┐                                                       │
│   │   VÍDEO     │  → Watch folder / upload manual                       │
│   └──────┬──────┘                                                       │
│          │                                                              │
│          ▼                                                              │
│   ┌─────────────────────────────────────────────────────────────┐      │
│   │  SERVIDOR CAPIAU (Python + SQLite + LiteLLM Proxy)          │      │
│   │  ─────────────────────────────────────────────────────       │      │
│   │  • FastAPI (API REST)                                       │      │
│   │  • SQLite (metadados)                                       │      │
│   │  • LiteLLM Proxy (roteamento de APIs)                       │      │
│   │  • Qdrant Cloud (busca semântica)                           │      │
│   └────────────────────┬────────────────────────────────────────┘      │
│                        │                                                │
│        ┌───────────────┼───────────────┬───────────────┐               │
│        │               │               │               │               │
│        ▼               ▼               ▼               ▼               │
│   ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐          │
│   │AssemblyAI│   │ DeepSeek │   │  Groq    │   │  Qdrant  │          │
│   │  (STT)   │   │  (LLM)   │   │  (LLM)   │   │ (Vector) │          │
│   │$0.15/h   │   │$0.28/1M  │   │$0.08/1M  │   │  Free    │          │
│   │Free:$50  │   │Free:5M   │   │Free:14.4K│   │  Cloud   │          │
│   └─────────┘   └──────────┘   │reqs/dia  │   └──────────┘          │
│        │               │       └──────────┘                          │
│        │               │               │                              │
│   ┌────┴────┐   ┌────┴────┐   ┌────┴────┐                          │
│   │Deepgram │   │Together │   │ OpenAI  │  ← Fallbacks             │
│   │(backup) │   │ (backup)│   │(backup) │                          │
│   │$0.26/h  │   │$0.88/1M │   │$10/1M   │                          │
│   │Free:$200│   │Free:$5   │   │Free:$5   │                          │
│   └─────────┘   └──────────┘   └─────────┘                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Setup Completo (2-3 Horas)

### 3.1 Criar Contas e Obter API Keys (30 min)

| # | Provedor | URL | Free Tier | API Key |
|:---|:---|:---|:---|:---|
| 1 | **DeepSeek** | [platform.deepseek.com](https://platform.deepseek.com) | 5M tokens | `sk-...` |
| 2 | **Groq** | [console.groq.com](https://console.groq.com) | 14.4K reqs/dia | `gsk_...` |
| 3 | **AssemblyAI** | [assemblyai.com](https://assemblyai.com) | $50 crédito | `...` |
| 4 | **Deepgram** | [deepgram.com](https://deepgram.com) | $200 crédito | `...` |
| 5 | **OpenAI** | [platform.openai.com](https://platform.openai.com) | $5 crédito | `sk-...` |
| 6 | **Qdrant** | [cloud.qdrant.io](https://cloud.qdrant.io) | 1M vetores free | Cluster URL + API Key |
| 7 | **Cloudflare** | [dash.cloudflare.com](https://dash.cloudflare.com) | 100K reqs/mês | Account ID + Token |

**Dica:** Comece pelos 3 principais: **DeepSeek + Groq + AssemblyAI**. Os demais são fallbacks.

### 3.2 Instalação do Ambiente (20 min)

```bash
# Criar diretório do projeto
mkdir -p ~/capiau-api && cd ~/capiau-api

# Python 3.10+
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip

# Instalar dependências (muito menor que a versão local!)
pip install \
    fastapi uvicorn[standard] \
    sqlite3-python \
    assemblyai \
    groq \
    openai \
    qdrant-client \
    sentence-transformers \
    requests \
    python-multipart \
    opentimelineio \
    "litellm[proxy]" \
    pyyaml

# FFmpeg (apenas para metadados e proxy — não precisa de modelos!)
sudo apt update && sudo apt install -y ffmpeg

# Criar estrutura
mkdir -p {src,config,data,watch,exports}
mkdir -p src/{db,ingest,transcription,nlp,search,export}
```

### 3.3 Configurar Variáveis de Ambiente

```bash
# Criar arquivo .env
cat > ~/capiau-api/.env << 'EOF'
# ── API KEYS ───────────────────────────────────────────────
DEEPSEEK_API_KEY=sk-sua-chave-aqui
GROQ_API_KEY=gsk-sua-chave-aqui
ASSEMBLYAI_API_KEY=sua-chave-aqui
DEEPGRAM_API_KEY=sua-chave-aqui
OPENAI_API_KEY=sk-sua-chave-aqui

# ── Qdrant Cloud ───────────────────────────────────────────
QDRANT_URL=https://sua-url.cloud.qdrant.io
QDRANT_API_KEY=sua-chave-qdrant

# ── Configuração CaIAu Talho ────────────────────────────────────
capiau_DB=./data/capiau.db
capiau_WATCH=./watch
capiau_EXPORTS=./exports
capiau_CACHE=./data/cache

# ── LiteLLM Proxy ──────────────────────────────────────────
LITELLM_MASTER_KEY=sk-capiau-mvp-2026
EOF

# Carregar
set -a && source .env && set +a
```

---

## 4. LiteLLM Proxy — O Coração da Arquitetura

### 4.1 Por que LiteLLM?

LiteLLM é um **proxy server open-source** que unifica todas as APIs em um único endpoint OpenAI-compatible. Você configura uma vez e depois troca de provedor alterando apenas uma linha no YAML.

**Benefícios para o MVP:**
- **1 integração** no código do CaIAu Talho (em vez de 5+)
- **Fallback automático**: DeepSeek cai → Groq assume → Together AI → OpenAI
- **Virtual keys** com budgets por "projeto" (Ficção: $5, Doc: $10)
- **Caching** Redis (reduz chamadas repetidas em 30-50%)
- **Custo do proxy: $0** (open-source, self-hosted)

### 4.2 Configuração: `config/litellm.yaml`

```yaml
# config/litellm.yaml — Configuração do proxy para MVP

general_settings:
  master_key: sk-capiau-mvp-2026
  proxy_batch_write_at: 60

# ═══════════════════════════════════════════════════════════
# MODELOS DISPONÍVEIS (routing automático)
# ═══════════════════════════════════════════════════════════

model_list:

  # ── Router: Tarefas SIMPLES (classificação, resumo) ──
  - model_name: capiau-simple
    litellm_params:
      - model: groq/llama-3.1-8b-instant
        api_key: os.environ/GROQ_API_KEY
        weight: 0.8
      - model: deepseek/deepseek-chat
        api_key: os.environ/DEEPSEEK_API_KEY
        weight: 0.2
    fallback: [groq/llama-3.1-8b-instant]

  # ── Router: Tarefas MÉDIAS (análise de cena) ──
  - model_name: capiau-medium
    litellm_params:
      - model: groq/llama-3.3-70b-versatile
        api_key: os.environ/GROQ_API_KEY
        weight: 0.6
      - model: deepseek/deepseek-chat
        api_key: os.environ/DEEPSEEK_API_KEY
        weight: 0.4
    fallback: [groq/llama-3.3-70b-versatile, deepseek/deepseek-chat]

  # ── Router: Tarefas COMPLEXAS (decisão editorial) ──
  - model_name: capiau-complex
    litellm_params:
      - model: openai/gpt-4o
        api_key: os.environ/OPENAI_API_KEY
        weight: 1.0
    fallback: [groq/llama-3.3-70b-versatile]

  # ── Embeddings ──
  - model_name: capiau-embedding
    litellm_params:
      model: openai/text-embedding-3-small
      api_key: os.environ/OPENAI_API_KEY

# ═══════════════════════════════════════════════════════════
# VIRTUAL KEYS COM BUDGETS (1 por perfil)
# ═══════════════════════════════════════════════════════════

key_management_settings:
  - key_alias: "mvp-fiction"
    max_budget: 5.00          # $5 para teste de ficção
    budget_duration: "30d"
    allowed_models: [capiau-simple, capiau-medium, capiau-complex, capiau-embedding]
    rpm_limit: 100

  - key_alias: "mvp-documentary"
    max_budget: 10.00         # $10 para teste de documentário
    budget_duration: "30d"
    allowed_models: [capiau-simple, capiau-medium, capiau-embedding]
    rpm_limit: 200

# ═══════════════════════════════════════════════════════════
# CACHING (Redis — opcional, aumenta performance)
# ═══════════════════════════════════════════════════════════

caching: true
caching_params:
  type: "redis"
  host: "localhost"
  port: 6379
  password: null
  ttl: 3600  # 1 hora
```

### 4.3 Iniciar o Proxy

```bash
cd ~/capiau-api
source venv/bin/activate

# Instalar e iniciar Redis (para caching)
sudo apt install -y redis-server
sudo systemctl start redis-server

# Iniciar LiteLLM Proxy
litellm --config config/litellm.yaml --port 4000

# Verificar em outro terminal:
curl http://localhost:4000/v1/models \
  -H "Authorization: Bearer sk-capiau-mvp-2026"
# Deve retornar lista de modelos configurados
```

---

## 5. Código do Pipeline MVP

### 5.1 `src/db/schema.py` (Schema SQLite — igual ao local)

```python
"""Schema SQLite — mesma estrutura da versão local."""
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS project (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    profile TEXT DEFAULT 'fiction',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS video (
    id INTEGER PRIMARY KEY,
    project_id INTEGER,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    hash TEXT UNIQUE,
    duration REAL, fps REAL, resolution TEXT, codec TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transcript (
    id INTEGER PRIMARY KEY, video_id INTEGER,
    word TEXT, start_time REAL, end_time REAL,
    speaker_id TEXT, confidence REAL
);

CREATE TABLE IF NOT EXISTS scene_analysis (
    id INTEGER PRIMARY KEY, video_id INTEGER,
    timestamp REAL, objects TEXT, faces TEXT,
    description TEXT, emotion TEXT
);

CREATE INDEX IF NOT EXISTS idx_transcript_video ON transcript(video_id);
CREATE INDEX IF NOT EXISTS idx_transcript_time ON transcript(start_time, end_time);
"""

def init_db(db_path: Path):
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    conn.execute("INSERT OR IGNORE INTO project (id, name) VALUES (1, 'MVP Ficção')")
    conn.commit()
    conn.close()
```

### 5.2 `src/transcription/assemblyai_pipe.py` (Transcrição via API)

```python
"""Transcrição via AssemblyAI API — palavra-a-palavra + diarização."""
import os
import sqlite3
import assemblyai as aai
from pathlib import Path

aai.settings.api_key = os.environ["ASSEMBLYAI_API_KEY"]

def transcribe_with_assemblyai(video_path: Path, video_id: int, db_path: Path):
    """Transcreve um vídeo usando AssemblyAI Universal-2.
    
    Custo: $0.15/hora (ou FREE com os $50 de crédito inicial)
    """
    print(f"\n[STT] Enviando para AssemblyAI: {video_path.name}")
    
    config = aai.TranscriptionConfig(
        speech_model=aai.SpeechModel.best,
        language_code="pt",           # Português do Brasil
        speaker_labels=True,           # Diarização
        word_boost=["capiau"],         # Vocabulary customizado
        format_text=True,
        punctuate=True,
    )
    
    transcriber = aai.Transcriber()
    transcript = transcriber.transcribe(str(video_path), config=config)
    
    if transcript.status == aai.TranscriptStatus.error:
        print(f"  Erro: {transcript.error}")
        return None
    
    # Salvar no banco
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Palavras com timestamps
    for word in transcript.words:
        cursor.execute("""
            INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id, confidence)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (video_id, word.text, word.start / 1000, word.end / 1000,
              word.speaker or "UNKNOWN", getattr(word, 'confidence', 1.0)))
    
    conn.commit()
    conn.close()
    
    word_count = len(transcript.words)
    speakers = set(w.speaker for w in transcript.words if w.speaker)
    print(f"  Palavras: {word_count} | Falantes: {len(speakers)} | Status: {transcript.status}")
    
    return transcript

# ── Fallback: Deepgram ──
def transcribe_with_deepgram(video_path: Path, video_id: int, db_path: Path):
    """Fallback para Deepgram ($0.26/hora, $200 free credit)."""
    from deepgram import DeepgramClient, PrerecordedOptions, FileSource
    import json
    
    print(f"\n[STT] Enviando para Deepgram: {video_path.name}")
    
    client = DeepgramClient(os.environ["DEEPGRAM_API_KEY"])
    
    with open(video_path, "rb") as f:
        buffer_data = f.read()
    
    payload: FileSource = {"buffer": buffer_data, "mimetype": "video/mp4"}
    options = PrerecordedOptions(
        model="nova-2",
        language="pt-BR",
        diarize=True,
        punctuate=True,
        utterances=True,
        paragraphs=True,
    )
    
    response = client.listen.prerecorded.v("1").transcribe_file(payload, options)
    
    # Parse e salvar
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    for utterance in response.results.utterances:
        for word in utterance.words:
            cursor.execute("""
                INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id, confidence)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (video_id, word.word, word.start, word.end,
                  utterance.speaker or "UNKNOWN", word.confidence))
    
    conn.commit()
    conn.close()
    print(f"  Deepgram: {len(response.results.utterances)} utterances processadas")
    return response
```

### 5.3 `src/nlp/llm_analysis.py` (Análise via API via LiteLLM)

```python
"""Análise textual via LLM usando LiteLLM Proxy (DeepSeek/Groq/OpenAI)."""
import os
import json
from pathlib import Path
from openai import OpenAI

# Conecta ao LiteLLM Proxy (não diretamente aos provedores!)
client = OpenAI(
    base_url="http://localhost:4000",
    api_key="sk-capiau-mvp-2026"  # Master key do LiteLLM
)

def analyze_scene(scene_text: str, router: str = "capiau-medium") -> dict:
    """Analisa uma cena e retorna decisões editoriais.
    
    Custo estimado: ~$0.001-0.005 por análise (DeepSeek/Groq)
    """
    prompt = f"""Você é um editor de cinema experiente. Analise a seguinte transcrição de cena 
e forneça uma análise estruturada em JSON:

TRANSCRIÇÃO:
{scene_text}

Responda APENAS com um JSON válido no formato:
{{
    "resumo": "resumo da cena em 1 frase",
    "personagens_presentes": ["nome1", "nome2"],
    "emocao_dominante": "descrição",
    "pontos_chave": ["momento1", "momento2"],
    "sugestao_corte": "onde cortar e por quê",
    "qualidade_tecnica": "nota 1-10 e justificativa",
    "continuidade": "observações de continuidade"
}}"""

    response = client.chat.completions.create(
        model=router,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=1000,
        metadata={"project": "mvp-fiction"}
    )
    
    content = response.choices[0].message.content
    
    # Extrair JSON da resposta
    try:
        # Remover markdown ```json ... ``` se presente
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        return json.loads(content.strip())
    except json.JSONDecodeError:
        return {"resumo": content[:500], "erro": "JSON malformado"}

def describe_frame_with_llm(frame_description: str) -> str:
    """Descreve uma cena cinematográfica usando LLM.
    
    Usado como fallback quando visão local não está disponível.
    """
    prompt = f"""Descreva esta cena de forma cinematográfica. Seja conciso (2-3 frases):

{frame_description}"""

    response = client.chat.completions.create(
        model="capiau-simple",  # Groq 8B — rápido e barato
        messages=[{"role": "user", "content": prompt}],
        temperature=0.5,
        max_tokens=200,
    )
    
    return response.choices[0].message.content.strip()

def generate_editorial_justification(take_info: dict) -> str:
    """Gera justificativa editorial para escolha de take.
    
    Usa modelo complexo (GPT-4o) apenas quando necessário.
    """
    prompt = f"""Justifique editorialmente a escolha deste take:

Take: {take_info.get('take_num', '?')}
Duração: {take_info.get('duration', '?')}s
Atores: {', '.join(take_info.get('actors', []))}
Transcrição: {take_info.get('transcript', '')[:500]}
Qualidade técnica: {take_info.get('tech_quality', '?')}/10

Explique em 2-3 frases por que este take deve ser escolhido (ou não)."""

    # Usar medium primeiro; se o resultado não for bom, retry com complex
    response = client.chat.completions.create(
        model="capiau-medium",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        max_tokens=300,
    )
    
    return response.choices[0].message.content.strip()
```

### 5.4 `src/search/semantic_qdrant.py` (Busca Semântica Cloud)

```python
"""Busca semântica usando Qdrant Cloud (free tier: 1M vetores)."""
import os
import sqlite3
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from sentence_transformers import SentenceTransformer

class SemanticSearchCloud:
    def __init__(self):
        self.client = QdrantClient(
            url=os.environ["QDRANT_URL"],
            api_key=os.environ["QDRANT_API_KEY"],
        )
        self.encoder = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
        self.collection = "capiau_mvp"
        self._init_collection()
    
    def _init_collection(self):
        """Cria coleção se não existir."""
        collections = [c.name for c in self.client.get_collections().collections]
        if self.collection not in collections:
            self.client.create_collection(
                collection_name=self.collection,
                vectors_config=VectorParams(size=384, distance=Distance.COSINE)
            )
            print(f"[Qdrant] Coleção '{self.collection}' criada")
    
    def index_transcript(self, video_id: int, db_path: str):
        """Indexa transcrição em segmentos de 30s."""
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT CAST(start_time / 30 AS INTEGER) * 30 as seg_start,
                   GROUP_CONCAT(word, ' ') as text
            FROM transcript WHERE video_id = ?
            GROUP BY seg_start ORDER BY seg_start
        """, (video_id,))
        
        points = []
        for seg_start, text in cursor.fetchall():
            if not text.strip():
                continue
            emb = self.encoder.encode(text).tolist()
            points.append(PointStruct(
                id=f"v{video_id}_t{int(seg_start)}",
                vector=emb,
                payload={"video_id": video_id, "type": "transcript",
                        "start": seg_start, "text": text[:500]}
            ))
        
        conn.close()
        
        if points:
            self.client.upsert(self.collection, points)
            print(f"[Qdrant] {len(points)} segmentos indexados")
    
    def search(self, query: str, video_id: int = None, limit: int = 10):
        """Busca semântica."""
        emb = self.encoder.encode(query).tolist()
        
        filt = None
        if video_id:
            from qdrant_client.models import Filter, FieldCondition, MatchValue
            filt = Filter(must=[FieldCondition(key="video_id", match=MatchValue(value=video_id))])
        
        return self.client.search(
            collection_name=self.collection,
            query_vector=emb,
            query_filter=filt,
            limit=limit
        )
```

### 5.5 `src/pipeline_api.py` (Orquestrador Principal)

```python
"""Pipeline MVP usando APIs — orquestrador principal."""
import sys
import time
from pathlib import Path
import sqlite3
import hashlib

from src.db.schema import init_db
from src.transcription.assemblyai_pipe import transcribe_with_assemblyai
from src.transcription.assemblyai_pipe import transcribe_with_deepgram
from src.nlp.llm_analysis import analyze_scene, describe_frame_with_llm
from src.search.semantic_qdrant import SemanticSearchCloud
from src.export.otio_export import export_otio

DB_PATH = Path("./data/capiau.db")

def get_video_metadata(filepath: Path) -> dict:
    import subprocess, json
    cmd = ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', str(filepath)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    d = json.loads(r.stdout)
    vs = next((s for s in d.get('streams', []) if s.get('codec_type') == 'video'), {})
    f = d.get('format', {})
    return {
        'duration': float(f.get('duration', 0)),
        'fps': eval(vs.get('r_frame_rate', '0/1')),
        'resolution': f"{vs.get('width', 0)}x{vs.get('height', 0)}",
        'codec': vs.get('codec_name', 'unknown'),
    }

def ingest_video(filepath: Path) -> int:
    """Ingest: metadados + banco."""
    init_db(DB_PATH)
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    h = hashlib.sha256(open(filepath, 'rb').read()).hexdigest()[:32]
    c.execute("SELECT id FROM video WHERE hash = ?", (h,))
    if c.fetchone():
        print("  Vídeo já existe (hash match)")
        conn.close()
        return None
    
    meta = get_video_metadata(filepath)
    c.execute("""
        INSERT INTO video (project_id, filename, filepath, hash, duration, fps, resolution, codec, status)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'ingested')
    """, (filepath.name, str(filepath), h, meta['duration'], meta['fps'],
          meta['resolution'], meta['codec']))
    vid = c.lastrowid
    conn.commit()
    conn.close()
    print(f"  [INGEST] ID={vid} | {meta['duration']:.1f}s | {meta['resolution']}")
    return vid

def run_pipeline_api(video_path: Path):
    """Pipeline completo usando APIs."""
    print("=" * 65)
    print(f"  CAPIAU MVP — APIs DE BAIXO CUSTO")
    print(f"  Arquivo: {video_path.name}")
    print("=" * 65)
    
    t0 = time.time()
    
    # 1. Ingest
    print("\n[1/5] INGEST + METADADOS")
    video_id = ingest_video(video_path)
    if not video_id:
        return
    
    # 2. Transcrição (AssemblyAI — $0.15/h ou FREE)
    print("\n[2/5] TRANSCRIÇÃO (AssemblyAI)")
    try:
        transcript = transcribe_with_assemblyai(video_path, video_id, DB_PATH)
    except Exception as e:
        print(f"  AssemblyAI falhou: {e}")
        print("  Tentando Deepgram (fallback)...")
        transcript = transcribe_with_deepgram(video_path, video_id, DB_PATH)
    
    # 3. Análise LLM (DeepSeek/Groq — $0.28/1M tokens ou FREE)
    print("\n[3/5] ANÁLISE LLM (DeepSeek/Groq)")
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT word FROM transcript WHERE video_id = ? ORDER BY start_time", (video_id,))
    full_text = " ".join(w[0] for w in c.fetchall())
    conn.close()
    
    # Dividir em segmentos de ~500 palavras e analisar
    words = full_text.split()
    segment_size = 500
    analyses = []
    
    for i in range(0, len(words), segment_size):
        seg_text = " ".join(words[i:i+segment_size])
        analysis = analyze_scene(seg_text, router="capiau-medium")
        analyses.append(analysis)
        print(f"  Segmento {i//segment_size + 1}: {analysis.get('resumo', 'N/A')[:60]}...")
    
    # 4. Indexação semântica (Qdrant Cloud — FREE)
    print("\n[4/5] INDEXAÇÃO SEMÂNTICA (Qdrant Cloud)")
    search = SemanticSearchCloud()
    search.index_transcript(video_id, str(DB_PATH))
    
    # 5. Exportação
    print("\n[5/5] EXPORTAÇÃO")
    export_path = Path("./exports") / f"{video_path.stem}.otio"
    export_otio(video_id, DB_PATH, export_path)
    
    # Resumo
    elapsed = (time.time() - t0) / 60
    duration_min = get_video_metadata(video_path)['duration'] / 60
    
    print(f"\n{'=' * 65}")
    print(f"  CONCLUÍDO em {elapsed:.1f} minutos")
    print(f"  Vídeo: {duration_min:.1f} min | Processado: {elapsed:.1f} min")
    print(f"  Speedup: {duration_min/elapsed:.1f}x real-time")
    print(f"  Custo estimado: ~${duration_min * 0.0025 + 0.05:.2f} (STT + LLM)")
    print(f"  Export: {export_path}")
    print(f"{'=' * 65}\n")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python src/pipeline_api.py <video.mp4>")
        sys.exit(1)
    run_pipeline_api(Path(sys.argv[1]))
```

---

## 6. Docker Compose Completo (Opcional)

```yaml
# docker-compose.yml — Todo o MVP em containers
version: "3.8"

services:
  # LiteLLM Proxy (gateway unificado)
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    ports:
      - "4000:4000"
    volumes:
      - ./config/litellm.yaml:/app/config.yaml
    environment:
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
      - GROQ_API_KEY=${GROQ_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ASSEMBLYAI_API_KEY=${ASSEMBLYAI_API_KEY}
      - DEEPGRAM_API_KEY=${DEEPGRAM_API_KEY}
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    restart: unless-stopped

  # Redis (caching do LiteLLM)
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

  # App CaIAu Talho (FastAPI)
  capiau:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
      - ./watch:/app/watch
      - ./exports:/app/exports
    environment:
      - capiau_DB=/app/data/capiau.db
      - LITELLM_URL=http://litellm:4000
      - QDRANT_URL=${QDRANT_URL}
      - QDRANT_API_KEY=${QDRANT_API_KEY}
      - ASSEMBLYAI_API_KEY=${ASSEMBLYAI_API_KEY}
    depends_on:
      - litellm
      - redis
    restart: unless-stopped

volumes:
  redis-data:
```

**Dockerfile:**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Instalar FFmpeg e dependências
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Instalar Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY config/ ./config/

CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 7. Custo Detalhado para 20h de Vídeo

### 7.1 Cenário A: Apenas Free Tiers ($0)

| Etapa | Provedor | Free Tier Usado | Custo |
|:---|:---|:---|:---|
| Transcrição 20h | AssemblyAI | $50 crédito (usa $3) | **$0** |
| LLM análise (~10M tokens) | DeepSeek | 5M tokens | **$0** |
| LLM análise restante | Groq | 14.4K reqs/dia × 30 dias | **$0** |
| Classificação rápida | Groq 8B | Incluso no free tier | **$0** |
| Embeddings | OpenAI ($5 credit) | text-embedding-3-small | **$0** |
| Busca semântica | Qdrant Cloud | 1M vetores free | **$0** |
| **TOTAL** | | | **$0** |

### 7.2 Cenário B: Free Tier Esgotado ($6-12)

| Etapa | Provedor | Quantidade | Preço Unitário | Custo |
|:---|:---|:---|:---|:---|
| Transcrição 20h | AssemblyAI | 20 horas | $0.15/h | **$3.00** |
| LLM análise (~10M tokens out) | DeepSeek | 10M tokens | $0.28/1M | **$2.80** |
| LLM classificação (~5M tokens) | Groq 8B | 5M tokens | $0.08/1M | **$0.40** |
| Embeddings (~500K tokens) | OpenAI | 500K tokens | $0.02/1M | **$0.01** |
| Busca semântica | Qdrant Cloud | <1M vetores | Free | **$0** |
| **TOTAL** | | | | **$6.21** |

### 7.3 Cenário C: Usando GPT-4o para visão ($30-50)

Se você precisar de **descrição visual de frames** (não disponível em free tiers):

| Etapa | Provedor | Custo |
|:---|:---|:---|
| Transcrição 20h | AssemblyAI | $3.00 |
| LLM análise | DeepSeek/Groq | $3.20 |
| Visão: 20h × 1 frame/30s = 2.400 frames × $0.005 | GPT-4o Vision | **$12.00** |
| **TOTAL** | | **$18.20** |

**Alternativa econômica para visão:** Usar modelo local pequeno (LLaVA 7B via Ollama — $0) ou Groq Llama 3.3 70B com descrição textual dos frames extraídos.

---

## 8. Comparativo: Open Source Local vs APIs Baixo Custo

| Aspecto | Open Source Local | APIs Baixo Custo |
|:---|:---|:---|
| **Setup inicial** | 4-6 horas (modelos 20GB) | **2-3 horas** (apenas APIs) |
| **Hardware necessário** | RTX 3060+ (8GB VRAM) | **Qualquer máquina** (CPU) |
| **Custo para 20h** | $0 (só eletricidade ~$5) | **$0-12** |
| **Velocidade** | ~35-40 min/h de vídeo | **~15-20 min/h** (paralelismo de APIs) |
| **Privacidade** | 100% local | Dados enviados para APIs |
| **Dependência de internet** | Não necessária | **Obrigatória** |
| **Manutenção** | Atualizar modelos, gerenciar VRAM | **Zero** (provedores cuidam) |
| **Escalabilidade** | Limitada pelo hardware | **Ilimitada** (pagar mais = mais throughput) |
| **Qualidade STT** | Whisper medium (bom) | **AssemblyAI Universal-2 (superior)** |
| **Qualidade LLM** | Qwen2.5 7B (bom) | **DeepSeek V3 + Groq 70B (melhor)** |
| **Fallback** | Não (se quebra, para) | **Sim** (LiteLLM troca provedor) |
| **Ideal para** | Produções com dados sensíveis, internet limitada | **Prototipagem rápida, validação de conceito** |

---

## 9. Roteiro de Teste em 1 Dia

### Manhã (3h): Setup
1. Criar contas DeepSeek + Groq + AssemblyAI (**30 min**)
2. Instalar ambiente Python + dependências (**20 min**)
3. Configurar LiteLLM Proxy (**20 min**)
4. Criar banco de dados e testar conexões (**30 min**)
5. Implementar pipeline básico (**90 min**)

### Tarde (3h): Teste com Vídeo Real
1. Copiar 1 vídeo de teste (5-10 min) para `watch/` (**5 min**)
2. Executar pipeline completo (**30-60 min**)
3. Verificar transcrição no banco (**10 min**)
4. Testar busca semântica (**15 min**)
5. Exportar OTIO e abrir no DaVinci Resolve (**20 min**)
6. Documentar resultados e ajustar prompts (**60 min**)

### Noite: Análise e Decisão
- Comparar qualidade da transcrição API vs. expectativa
- Calcular custo real do dia
- Decidir: continuar com APIs ou migrar para híbrido?

---

## 10. Próximos Passos

| # | Ação | Tempo |
|:---|:---|:---|
| 1 | Parser de roteiro Fountain/FDX + alinhamento fuzzy | 2-3 dias |
| 2 | Interface web (Streamlit) para preview e busca | 1-2 dias |
| 3 | Suporte a múltiplos vídeos em batch | 1 dia |
| 4 | Worker queue (Redis/RQ) para processamento assíncrono | 1 dia |
| 5 | Integrar visão local (LLaVA via Ollama) como fallback | 1 dia |
| 6 | Testar com perfil Documentário (tratamento + B-roll) | 2-3 dias |
| 7 | Avaliar migração para cluster GPU se volume aumentar | — |

---

*MVP APIs de Baixo Custo — Junho 2026. Free tier + $0.15/h STT. Valide seu conceito em 1 dia.*
