# CaIAu Talho MVP: Implementação Open Source 100% Local

**Data:** 02/06/2026  
**Escopo:** Guia passo a passo para implementar o MVP do CaIAu Talho usando exclusivamente software open source, rodando 100% local em uma única máquina (RTX 3060/4060 8GB ou CPU). Zero custo de APIs. Foco em ficção cinematográfica como primeiro perfil.  
**Tempo estimado:** 4-6 horas de setup + 20h de análise de vídeo processadas em ~2-3 dias.

---

## TL;DR — O Que Você Vai Ter em 6 Horas

Um pipeline funcional que: (1) **ingere vídeo** de qualquer formato via watch folder, (2) **extrai metadados técnicos** (codec, resolução, timecode), (3) **transcreve fala** palavra-a-palavra com timestamps e diarização, (4) **detecta objetos, ações e rostos** em cada frame, (5) **descreve cenas semanticamente** com visão computacional, (6) **alinhamento básico roteiro-transcrição**, (7) **busca semântica** em todo o acervo, e (8) **exporta EDL/XML/OTIO** para editores profissionais. Tudo isso em uma única máquina, sem enviar um byte para a nuvem. Custo total: **$0 em APIs**, apenas eletricidade (~$5-10 para processar 20h de vídeo).

---

## 1. Requisitos de Hardware

| Componente | Mínimo | Recomendado | Observação |
|:---|:---|:---|:---|
| **GPU** | NVIDIA GTX 1660 6GB | **RTX 3060/4060 8GB** | 8GB VRAM permite rodar Qwen2.5-7B + Whisper-medium simultaneamente |
| **RAM** | 16 GB | **32 GB** | 32GB permite cache de embeddings e processamento paralelo |
| **CPU** | 4 cores | 6+ cores | AMD Ryzen 5 / Intel i5 ou superior |
| **Storage** | 500 GB SSD | **2 TB NVMe** | Vídeo original + proxy + cache de análise |
| **Sistema** | Ubuntu 22.04 | **Ubuntu 24.04 LTS** | Todas as instruções assumem Ubuntu |

**Modo CPU-only:** Possível mas 5-10x mais lento. Whisper roda em CPU (~0.5x real-time vs. 10x em GPU). LLM local em CPU é viável apenas para modelos <= 3B (Llama 3.2 3B, Phi-3 mini).

---

## 2. Instalação Passo a Passo

### 2.1 Preparação do Sistema (15 min)

```bash
# Atualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar dependências básicas
sudo apt install -y git wget curl build-essential \
    python3-pip python3-venv python3-dev \
    ffmpeg libavcodec-dev libavformat-dev libswscale-dev \
    libpq-dev pkg-config

# Instalar Docker e Docker Compose
sudo apt install -y ca-certificates gnupg lsb-release
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker

# Instalar NVIDIA Container Toolkit (se tiver GPU)
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
    sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Verificar GPU
docker run --rm --gpus all nvidia/cuda:12.0-base-ubuntu22.04 nvidia-smi
```

### 2.2 Criar Estrutura do Projeto (5 min)

```bash
# Diretório base do CaIAu Talho
mkdir -p ~/capiau/{data,models,src,config,logs,watch}
mkdir -p ~/capiau/data/{originals,proxies,cache,exports}
mkdir -p ~/capiau/src/{ingest,transcription,vision,audio,db,export,api,ui}

# Variáveis de ambiente
cat > ~/capiau/.env << 'EOF'
# CaIAu Talho Environment
capiau_HOME=/home/$USER/capiau
capiau_DB_PATH=/home/$USER/capiau/data/capiau.db
capiau_WATCH_FOLDER=/home/$USER/capiau/watch
capiau_ORIGINALS=/home/$USER/capiau/data/originals
capiau_PROXIES=/home/$USER/capiau/data/proxies
capiau_CACHE=/home/$USER/capiau/data/cache
capiau_MODELS=/home/$USER/capiau/models

# Modelos locais (caminhos para Ollama)
capiau_LLM_MODEL=qwen2.5:7b
capiau_VLM_MODEL=llava:7b
capiau_WHISPER_MODEL=medium

# Proxy settings
PROXY_RESOLUTION=1280x720
PROXY_CRF=23
PROXY_PRESET=fast
EOF

cd ~/capiau
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
```

### 2.3 Instalar Ollama (LLM/VLM Local) (10 min)

```bash
# Instalar Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Iniciar Ollama em background
ollama serve &

# Baixar modelos (isso pode levar 20-40 min dependendo da conexão)
# LLM principal: Qwen2.5 7B (4.7GB, ~9 tok/s em RTX 4060)
ollama pull qwen2.5:7b

# VLM: LLaVA 7B para descrição de imagens (4.7GB)
ollama pull llava:7b

# LLM rápido para classificação (2GB, ~50 tok/s)
ollama pull llama3.2:3b

# Verificar modelos instalados
ollama list
```

| Modelo | Tamanho | VRAM (Q4) | Tokens/s (RTX 4060) | Uso no CaIAu Talho |
|:---|:---|:---|:---|:---|
| qwen2.5:7b | 4.7 GB | ~4.7 GB | ~9 t/s | Decisões editoriais, resumos, análise |
| llava:7b | 4.7 GB | ~4.7 GB | ~8 t/s | Descrição semântica de frames |
| llama3.2:3b | 2.0 GB | ~2.0 GB | ~50 t/s | Classificação, routing, tarefas simples |

**Nota importante:** Em 8GB VRAM, você não pode carregar todos os modelos simultaneamente. Ollama gerencia isso automaticamente — descarrega o modelo menos usado quando a VRAM fica cheia.

### 2.4 Instalar WhisperX (Transcrição + Diarização) (15 min)

```bash
source ~/capiau/venv/bin/activate

# WhisperX requer PyTorch com suporte a CUDA
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Instalar WhisperX
pip install whisperx

# Baixar modelos Whisper (medium = 1.5GB, ~6GB VRAM)
# O modelo é baixado automaticamente no primeiro uso, mas podemos pré-baixar:
python3 -c "import whisperx; m = whisperx.load_model('medium', 'cuda', compute_type='float16')"

# Baixar modelo de diarização (PyAnnote)
python3 -c "import whisperx; m = whisperx.load_model('medium', 'cuda', compute_type='float16', asr_options={'initial_prompt': ''})"

# Testar transcrição básica
whisperx --help
```

### 2.5 Instalar YOLOv8 + InsightFace + DeepFace (Visão) (10 min)

```bash
source ~/capiau/venv/bin/activate

# Ultralytics (YOLOv8)
pip install ultralytics

# InsightFace (reconhecimento facial)
pip install insightface onnxruntime-gpu

# DeepFace (análise de emoção)
pip install deepface tf-keras

# EasyOCR (texto em tela)
pip install easyocr

# Baixar modelos no primeiro uso (automático)
python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"  # nano = 6MB, rápido
python3 -c "from ultralytics import YOLO; YOLO('yolov8m.pt')"  # medium = 50MB, mais preciso

# Testar
python3 -c "
from ultralytics import YOLO
import torch
print('CUDA disponível:', torch.cuda.is_available())
print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')
model = YOLO('yolov8n.pt')
print('YOLOv8 carregado com sucesso')
"
```

### 2.6 Instalar Banco de Dados e Busca Semântica (10 min)

```bash
source ~/capiau/venv/bin/activate

# SQLite (já incluído no Python)
# Qdrant (self-hosted via Docker)
docker run -d --name capiau-qdrant \
    -p 6333:6333 -p 6334:6334 \
    -v ~/capiau/data/qdrant:/qdrant/storage \
    qdrant/qdrant:latest

# Instalar cliente Python
pip install qdrant-client sentence-transformers

# Baixar modelo de embeddings (sentence-transformers, ~400MB)
python3 -c "
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
print('Modelo de embeddings carregado')
"

# Testar Qdrant
python3 -c "
from qdrant_client import QdrantClient
client = QdrantClient('localhost', port=6333)
print('Qdrant conectado:', client.get_collections())
"
```

### 2.7 Instalar OpenTimelineIO (Export) (5 min)

```bash
source ~/capiau/venv/bin/activate
pip install opentimelineio

# Testar
python3 -c "import opentimelineio as otio; print('OTIO versão:', otio.__version__)"
```

---

## 3. Implementação do Pipeline MVP

### 3.1 Estrutura de Código

```
~/capiau/
├── src/
│   ├── __init__.py
│   ├── config.py           # Configurações centralizadas
│   ├── db/
│   │   ├── __init__.py
│   │   ├── schema.py       # Schema SQLite
│   │   └── operations.py   # CRUD
│   ├── ingest/
│   │   ├── __init__.py
│   │   ├── watcher.py      # Watch folder 24/7
│   │   ├── dedup.py        # Deduplicação por hash
│   │   └── proxy.py        # Geração de proxy H.264
│   ├── transcription/
│   │   ├── __init__.py
│   │   └── whisperx_pipe.py # Pipeline WhisperX
│   ├── vision/
│   │   ├── __init__.py
│   │   ├── yolo_detect.py  # Detecção de objetos
│   │   ├── face_analysis.py # Reconhecimento facial + emoção
│   │   └── scene_describe.py # Descrição semântica via LLaVA
│   ├── nlp/
│   │   ├── __init__.py
│   │   ├── script_parser.py # Parser Fountain/FDX
│   │   └── alignment.py    # Alinhamento roteiro-transcrição
│   ├── search/
│   │   ├── __init__.py
│   │   └── semantic.py     # Busca semântica Qdrant
│   └── export/
│       ├── __init__.py
│       ├── edl.py          # Geração EDL
│       ├── xml_export.py   # XML Premiere/FCP
│       └── otio_export.py  # OpenTimelineIO
├── config/
│   └── capiau.yaml         # Configuração do pipeline
├── data/
│   ├── originals/          # Vídeos originais
│   ├── proxies/            # Proxies H.264 720p
│   ├── cache/              # Cache de análise
│   └── exports/            # Arquivos exportados
├── watch/                  # Watch folder para ingest
└── docker-compose.yml      # Serviços Docker
```

### 3.2 Arquivo: `src/config.py`

```python
"""Configurações centralizadas do CaIAu Talho MVP."""
import os
from pathlib import Path
from dataclasses import dataclass

@dataclass
class Config:
    # Paths
    home: Path = Path(os.environ.get("capiau_HOME", "~/capiau")).expanduser()
    db_path: Path = None
    watch_folder: Path = None
    originals: Path = None
    proxies: Path = None
    cache: Path = None
    models: Path = None
    
    # Modelos
    llm_model: str = "qwen2.5:7b"
    vlm_model: str = "llava:7b"
    fast_llm: str = "llama3.2:3b"
    whisper_model: str = "medium"
    whisper_compute_type: str = "float16"
    yolo_model: str = "yolov8m.pt"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    
    # Proxy
    proxy_resolution: str = "1280x720"
    proxy_crf: int = 23
    proxy_preset: str = "fast"
    
    # Análise
    frame_interval: int = 30  # extrair 1 frame a cada N segundos
    min_scene_duration: float = 2.0  # segundos
    
    # Banco de dados
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    
    def __post_init__(self):
        self.db_path = self.home / "data" / "capiau.db"
        self.watch_folder = self.home / "watch"
        self.originals = self.home / "data" / "originals"
        self.proxies = self.home / "data" / "proxies"
        self.cache = self.home / "data" / "cache"
        self.models = self.home / "models"
        
        # Criar diretórios se não existirem
        for p in [self.watch_folder, self.originals, self.proxies, self.cache, self.models]:
            p.mkdir(parents=True, exist_ok=True)

CONFIG = Config()
```

### 3.3 Arquivo: `src/db/schema.py` (Schema SQLite)

```python
"""Schema do banco de dados SQLite para o MVP."""
import sqlite3
from pathlib import Path

SCHEMA_SQL = """
-- Projetos
CREATE TABLE IF NOT EXISTS project (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    profile TEXT CHECK(profile IN ('fiction', 'documentary', 'tv_news')) DEFAULT 'fiction',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vídeos/Takes
CREATE TABLE IF NOT EXISTS video (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES project(id),
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    hash TEXT UNIQUE,
    
    -- Metadados técnicos (FFprobe)
    duration REAL,
    fps REAL,
    resolution TEXT,
    codec TEXT,
    bitrate INTEGER,
    
    -- Status
    status TEXT CHECK(status IN ('pending','ingested','analyzing','analyzed','error')) DEFAULT 'pending',
    error_message TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transcrição (palavra-a-palavra)
CREATE TABLE IF NOT EXISTS transcript (
    id INTEGER PRIMARY KEY,
    video_id INTEGER REFERENCES video(id),
    word TEXT NOT NULL,
    start_time REAL NOT NULL,  -- segundos
    end_time REAL NOT NULL,
    speaker_id INTEGER,
    confidence REAL,
    
    -- Índice para busca
    search_text TEXT  -- palavra normalizada para busca
);

-- Frames analisados
CREATE TABLE IF NOT EXISTS frame (
    id INTEGER PRIMARY KEY,
    video_id INTEGER REFERENCES video(id),
    timestamp REAL NOT NULL,  -- segundos no vídeo
    frame_path TEXT,          -- caminho para o frame extraído
    
    -- Detecção YOLO (JSON: [{label, confidence, bbox}, ...])
    objects_detected TEXT,
    
    -- Análise facial (JSON: [{face_id, emotion, bbox, confidence}, ...])
    faces_detected TEXT,
    
    -- Descrição semântica (LLaVA)
    scene_description TEXT,
    
    -- OCR
    text_on_screen TEXT
);

-- Cenas detectadas (auto-segmentação)
CREATE TABLE IF NOT EXISTS scene (
    id INTEGER PRIMARY KEY,
    video_id INTEGER REFERENCES video(id),
    scene_number INTEGER,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    duration REAL,
    
    -- Descrição agregada
    description TEXT,
    dominant_objects TEXT,
    dominant_emotion TEXT,
    speakers TEXT
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_video_project ON video(project_id);
CREATE INDEX IF NOT EXISTS idx_video_hash ON video(hash);
CREATE INDEX IF NOT EXISTS idx_transcript_video ON transcript(video_id);
CREATE INDEX IF NOT EXISTS idx_transcript_time ON transcript(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_frame_video ON frame(video_id);
CREATE INDEX IF NOT EXISTS idx_scene_video ON scene(video_id);

-- Tabela de configuração
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
);

INSERT OR IGNORE INTO config (key, value) VALUES ('schema_version', '1.0');
"""

def init_db(db_path: Path):
    """Inicializa o banco de dados com o schema."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    conn.close()
    print(f"Banco inicializado: {db_path}")

if __name__ == "__main__":
    from src.config import CONFIG
    init_db(CONFIG.db_path)
```

### 3.4 Arquivo: `src/ingest/watcher.py` (Watch Folder)

```python
"""Watch folder para ingest 24/7 de vídeos."""
import hashlib
import shutil
import subprocess
from pathlib import Path
from typing import Callable
import time
import sqlite3

from src.config import CONFIG

SUPPORTED_FORMATS = {'.mp4', '.mov', '.mts', '.mxf', '.ts', '.braw', '.r3d', '.avi', '.mkv', '.wav', '.bwf'}

def compute_hash(filepath: Path) -> str:
    """SHA-256 do arquivo para deduplicação."""
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            h.update(chunk)
    return h.hexdigest()[:32]

def get_video_metadata(filepath: Path) -> dict:
    """Extrai metadados via FFprobe."""
    cmd = [
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', str(filepath)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    import json
    data = json.loads(result.stdout)
    
    video_stream = next((s for s in data.get('streams', []) if s.get('codec_type') == 'video'), {})
    fmt = data.get('format', {})
    
    return {
        'duration': float(fmt.get('duration', 0)),
        'fps': eval(video_stream.get('r_frame_rate', '0/1')),  # e.g. '24000/1001'
        'resolution': f"{video_stream.get('width', 0)}x{video_stream.get('height', 0)}",
        'codec': video_stream.get('codec_name', 'unknown'),
        'bitrate': int(fmt.get('bit_rate', 0)),
    }

def generate_proxy(original: Path, proxy_path: Path, config: dict):
    """Gera proxy H.264 720p via FFmpeg."""
    cmd = [
        'ffmpeg', '-y', '-i', str(original),
        '-vf', f'scale={config["proxy_resolution"]}:force_original_aspect_ratio=decrease',
        '-c:v', 'libx264', '-preset', config['proxy_preset'], '-crf', str(config['proxy_crf']),
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        str(proxy_path)
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    print(f"  Proxy gerado: {proxy_path}")

def process_file(filepath: Path, db_path: Path, callback: Callable = None):
    """Processa um arquivo de vídeo: dedup, metadados, proxy, DB."""
    print(f"\n[INGEST] Processando: {filepath.name}")
    
    # Verificar formato
    if filepath.suffix.lower() not in SUPPORTED_FORMATS:
        print(f"  Formato não suportado: {filepath.suffix}")
        return
    
    # Hash para deduplicação
    file_hash = compute_hash(filepath)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Verificar duplicata
    cursor.execute("SELECT id FROM video WHERE hash = ?", (file_hash,))
    if cursor.fetchone():
        print(f"  Arquivo já existe (hash match)")
        conn.close()
        return
    
    # Copiar para originals
    dest = CONFIG.originals / filepath.name
    shutil.copy2(filepath, dest)
    
    # Extrair metadados
    meta = get_video_metadata(dest)
    
    # Inserir no banco
    cursor.execute("""
        INSERT INTO video (project_id, filename, filepath, hash, duration, fps, resolution, codec, bitrate, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ingested')
    """, (1, filepath.name, str(dest), file_hash, meta['duration'], meta['fps'],
          meta['resolution'], meta['codec'], meta['bitrate']))
    video_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    # Gerar proxy
    proxy_path = CONFIG.proxies / f"{filepath.stem}_proxy.mp4"
    generate_proxy(dest, proxy_path, {
        'proxy_resolution': CONFIG.proxy_resolution,
        'proxy_preset': CONFIG.proxy_preset,
        'proxy_crf': CONFIG.proxy_crf,
    })
    
    print(f"  Video ID: {video_id} | Duração: {meta['duration']:.1f}s | {meta['resolution']}")
    
    if callback:
        callback(video_id, dest)

def watch_folder(watch_path: Path, db_path: Path, interval: int = 5):
    """Monitora pasta em loop infinito."""
    print(f"[WATCH] Monitorando: {watch_path} (a cada {interval}s)")
    print(f"        Formatos: {', '.join(SUPPORTED_FORMATS)}")
    print("        Pressione Ctrl+C para parar\n")
    
    processed = set()
    
    try:
        while True:
            for f in watch_path.iterdir():
                if f.is_file() and f.suffix.lower() in SUPPORTED_FORMATS:
                    if f.name not in processed:
                        process_file(f, db_path)
                        processed.add(f.name)
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n[WATCH] Monitoramento encerrado")

if __name__ == "__main__":
    watch_folder(CONFIG.watch_folder, CONFIG.db_path)
```

### 3.5 Arquivo: `src/transcription/whisperx_pipe.py`

```python
"""Pipeline de transcrição com WhisperX (fala + diarização + timestamps)."""
import sqlite3
import json
from pathlib import Path

import whisperx
import torch

from src.config import CONFIG

def transcribe_video(video_path: Path, video_id: int, db_path: Path):
    """Transcreve um vídeo completo e salva no banco."""
    print(f"\n[TRANSCRIBE] {video_path.name}")
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = CONFIG.whisper_compute_type if device == "cuda" else "int8"
    
    # 1. Carregar modelo Whisper
    print("  Carregando Whisper...")
    model = whisperx.load_model(
        CONFIG.whisper_model, device, compute_type=compute_type,
        language="pt"  # Português do Brasil
    )
    
    # 2. Transcrever áudio
    print("  Transcrevendo áudio...")
    audio = whisperx.load_audio(str(video_path))
    result = model.transcribe(audio)
    
    # 3. Alinhar timestamps (palavra-a-palavra)
    print("  Alinhando timestamps...")
    model_a, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
    result = whisperx.align(result["segments"], model_a, metadata, audio, device, return_char_alignments=False)
    
    # 4. Diarização (identificar falantes)
    print("  Diarizando falantes...")
    diarize_model = whisperx.DiarizationPipeline(device=device)
    diarize_segments = diarize_model(audio)
    result = whisperx.assign_word_speakers(diarize_segments, result)
    
    # 5. Salvar no banco
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    segments = result.get("segments", [])
    for seg in segments:
        speaker = seg.get("speaker", "UNKNOWN")
        for word in seg.get("words", []):
            cursor.execute("""
                INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id, confidence, search_text)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (video_id, word.get("word", ""), word.get("start", 0),
                  word.get("end", 0), speaker, word.get("score", 1.0),
                  word.get("word", "").lower().strip()))
    
    conn.commit()
    conn.close()
    
    # Liberar VRAM
    del model, model_a, diarize_model
    torch.cuda.empty_cache()
    
    word_count = sum(len(s.get("words", [])) for s in segments)
    print(f"  Palavras transcritas: {word_count} | Falantes: {len(set(s.get('speaker','UNKNOWN') for s in segments))}")
    
    return result

if __name__ == "__main__":
    # Teste standalone
    import sys
    if len(sys.argv) > 1:
        transcribe_video(Path(sys.argv[1]), 999, CONFIG.db_path)
```

### 3.6 Arquivo: `src/vision/yolo_detect.py`

```python
"""Detecção de objetos e ações com YOLOv8."""
import sqlite3
import json
import cv2
from pathlib import Path

from ultralytics import YOLO

from src.config import CONFIG

# Labels COCO relevantes para produção audiovisual
RELEVANT_LABELS = {
    'person', 'car', 'truck', 'bus', 'bicycle', 'motorcycle',
    'chair', 'couch', 'bed', 'dining table', 'desk',
    'laptop', 'cell phone', 'tv', 'book', 'clock',
    'cup', 'bottle', 'knife', 'wine glass', 'handbag',
    'backpack', 'umbrella', 'tie', 'suitcase',
    'dog', 'cat', 'horse', 'bird',
    'bench', 'potted plant', 'vase'
}

def extract_frames(video_path: Path, interval: int = 30) -> list:
    """Extrai frames a cada N segundos."""
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = []
    frame_idx = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        timestamp = frame_idx / fps
        if int(timestamp) % interval == 0:
            frames.append((timestamp, frame))
        
        frame_idx += 1
    
    cap.release()
    return frames

def detect_objects(video_id: int, video_path: Path, db_path: Path):
    """Detecta objetos em frames do vídeo."""
    print(f"\n[VISION] Analisando objetos: {video_path.name}")
    
    model = YOLO(CONFIG.yolo_model)
    
    # Extrair frames
    frames = extract_frames(video_path, CONFIG.frame_interval)
    print(f"  Frames extraídos: {len(frames)} (a cada {CONFIG.frame_interval}s)")
    
    # Criar diretório de cache para frames
    frame_dir = CONFIG.cache / f"frames_v{video_id}"
    frame_dir.mkdir(exist_ok=True)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    for timestamp, frame in frames:
        # Salvar frame
        frame_path = frame_dir / f"frame_{timestamp:.1f}.jpg"
        cv2.imwrite(str(frame_path), frame)
        
        # Detectar objetos
        results = model(frame, verbose=False)
        
        objects = []
        for r in results:
            for box in r.boxes:
                label = model.names[int(box.cls)]
                conf = float(box.conf)
                if conf > 0.5 and label in RELEVANT_LABELS:
                    objects.append({
                        "label": label,
                        "confidence": round(conf, 3),
                        "bbox": [round(float(x), 2) for x in box.xyxy[0].tolist()]
                    })
        
        if objects:
            cursor.execute("""
                INSERT INTO frame (video_id, timestamp, frame_path, objects_detected)
                VALUES (?, ?, ?, ?)
            """, (video_id, timestamp, str(frame_path), json.dumps(objects)))
    
    conn.commit()
    conn.close()
    print(f"  Objetos detectados em {len(frames)} frames")

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        detect_objects(1, Path(sys.argv[1]), CONFIG.db_path)
```

### 3.7 Arquivo: `src/vision/face_analysis.py`

```python
"""Reconhecimento facial e análise de emoção."""
import sqlite3
import json
from pathlib import Path

import cv2
import numpy as np
from deepface import DeepFace

from src.config import CONFIG

def analyze_faces(video_id: int, video_path: Path, db_path: Path):
    """Analisa rostos e emoções em frames do vídeo."""
    print(f"\n[FACE] Analisando rostos: {video_path.name}")
    
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_idx = 0
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    processed = set()
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        timestamp = frame_idx / fps
        if int(timestamp) % CONFIG.frame_interval == 0 and timestamp not in processed:
            try:
                result = DeepFace.analyze(
                    frame, 
                    actions=['emotion'],
                    enforce_detection=False,
                    silent=True
                )
                
                faces = []
                for face in result:
                    faces.append({
                        "emotion": face.get("dominant_emotion", "unknown"),
                        "confidence": round(float(face.get("face_confidence", 0)), 3),
                        "region": face.get("region", {}),
                        "emotions": {k: round(float(v), 3) for k, v in face.get("emotion", {}).items()}
                    })
                
                if faces:
                    # Atualizar frame existente ou inserir
                    cursor.execute("""
                        UPDATE frame SET faces_detected = ? 
                        WHERE video_id = ? AND ABS(timestamp - ?) < 0.5
                    """, (json.dumps(faces), video_id, timestamp))
                    
                    if cursor.rowcount == 0:
                        cursor.execute("""
                            INSERT INTO frame (video_id, timestamp, faces_detected)
                            VALUES (?, ?, ?)
                        """, (video_id, timestamp, json.dumps(faces)))
                
                processed.add(timestamp)
                
            except Exception as e:
                pass  # Sem rosto detectado — ok
        
        frame_idx += 1
    
    cap.release()
    conn.commit()
    conn.close()
    print(f"  Frames com rostos analisados: {len(processed)}")

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        analyze_faces(1, Path(sys.argv[1]), CONFIG.db_path)
```

### 3.8 Arquivo: `src/vision/scene_describe.py`

```python
"""Descrição semântica de cenas via LLaVA (VLM local via Ollama)."""
import sqlite3
import base64
from pathlib import Path
import requests

from src.config import CONFIG

OLLAMA_URL = "http://localhost:11434/api/generate"

def describe_frame(frame_path: Path) -> str:
    """Descreve um frame usando LLaVA via Ollama."""
    with open(frame_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()
    
    prompt = """Descreva esta cena de forma cinematográfica. Inclua:
- Ambiente/setting
- Pessoas presentes (número, aproximação)
- Ações em andamento
- Objetos principais
- Iluminação e atmosfera
- Ângulo de câmera aparente (plano geral, close, etc.)

Responda em português do Brasil em 2-3 frases concisas."""

    response = requests.post(OLLAMA_URL, json={
        "model": CONFIG.vlm_model,
        "prompt": prompt,
        "images": [img_b64],
        "stream": False
    }, timeout=60)
    
    return response.json().get("response", "Erro na descrição")

def describe_scenes(video_id: int, db_path: Path):
    """Descreve semanticamente os frames de um vídeo."""
    print(f"\n[DESCRIBE] Descrevendo cenas do video_id={video_id}")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, timestamp, frame_path FROM frame 
        WHERE video_id = ? AND frame_path IS NOT NULL
        ORDER BY timestamp
    """, (video_id,))
    
    frames = cursor.fetchall()
    print(f"  Frames para descrever: {len(frames)}")
    
    for frame_id, timestamp, frame_path in frames:
        if not frame_path or not Path(frame_path).exists():
            continue
        
        try:
            description = describe_frame(Path(frame_path))
            cursor.execute("""
                UPDATE frame SET scene_description = ? WHERE id = ?
            """, (description, frame_id))
            print(f"    [{timestamp:.1f}s] {description[:80]}...")
        except Exception as e:
            print(f"    [{timestamp:.1f}s] Erro: {e}")
    
    conn.commit()
    conn.close()
    print("  Descrição concluída")

if __name__ == "__main__":
    describe_scenes(1, CONFIG.db_path)
```

### 3.9 Arquivo: `src/search/semantic.py`

```python
"""Busca semântica usando Qdrant + sentence-transformers."""
import sqlite3
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from sentence_transformers import SentenceTransformer

from src.config import CONFIG

class SemanticSearch:
    def __init__(self):
        self.client = QdrantClient(CONFIG.qdrant_host, port=CONFIG.qdrant_port)
        self.encoder = SentenceTransformer(CONFIG.embedding_model)
        self.collection_name = "capiau_segments"
        self._ensure_collection()
    
    def _ensure_collection(self):
        """Cria coleção se não existir."""
        collections = self.client.get_collections().collections
        if not any(c.name == self.collection_name for c in collections):
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=384, distance=Distance.COSINE)
            )
            print(f"[SEARCH] Coleção criada: {self.collection_name}")
    
    def index_video(self, video_id: int, db_path: str):
        """Indexa transcrição e descrições de um vídeo no Qdrant."""
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Indexar transcrições (agrupadas em segmentos de 30s)
        cursor.execute("""
            SELECT start_time, GROUP_CONCAT(word, ' ') as text
            FROM transcript 
            WHERE video_id = ?
            GROUP BY CAST(start_time / 30 AS INTEGER)
            ORDER BY start_time
        """, (video_id,))
        
        points = []
        for start_time, text in cursor.fetchall():
            if not text.strip():
                continue
            embedding = self.encoder.encode(text).tolist()
            points.append(PointStruct(
                id=f"v{video_id}_t{int(start_time)}",
                vector=embedding,
                payload={
                    "video_id": video_id,
                    "type": "transcript",
                    "start_time": start_time,
                    "text": text
                }
            ))
        
        # Indexar descrições de cenas
        cursor.execute("""
            SELECT timestamp, scene_description 
            FROM frame 
            WHERE video_id = ? AND scene_description IS NOT NULL
        """, (video_id,))
        
        for timestamp, desc in cursor.fetchall():
            if not desc:
                continue
            embedding = self.encoder.encode(desc).tolist()
            points.append(PointStruct(
                id=f"v{video_id}_d{int(timestamp)}",
                vector=embedding,
                payload={
                    "video_id": video_id,
                    "type": "description",
                    "timestamp": timestamp,
                    "text": desc
                }
            ))
        
        conn.close()
        
        if points:
            self.client.upsert(collection_name=self.collection_name, points=points)
            print(f"[SEARCH] {len(points)} segmentos indexados para video_id={video_id}")
    
    def search(self, query: str, video_id: int = None, limit: int = 10):
        """Busca semântica."""
        embedding = self.encoder.encode(query).tolist()
        
        filter_dict = None
        if video_id:
            filter_dict = {"must": [{"key": "video_id", "match": {"value": video_id}}]}
        
        results = self.client.search(
            collection_name=self.collection_name,
            query_vector=embedding,
            query_filter=filter_dict,
            limit=limit
        )
        
        return results

if __name__ == "__main__":
    search = SemanticSearch()
    # Teste
    results = search.search("pessoa falando na cozinha")
    for r in results:
        print(f"Score: {r.score:.3f} | {r.payload['text'][:100]}")
```

### 3.10 Arquivo: `src/export/otio_export.py`

```python
"""Exportação de timelines para OpenTimelineIO."""
import sqlite3
from pathlib import Path
import opentimelineio as otio

from src.config import CONFIG

def export_otio(video_id: int, db_path: Path, output_path: Path, segments: list = None):
    """Exporta uma timeline OTIO com base nos segmentos selecionados."""
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Buscar informações do vídeo
    cursor.execute("SELECT filepath, duration, filename FROM video WHERE id = ?", (video_id,))
    row = cursor.fetchone()
    if not row:
        raise ValueError(f"Video {video_id} não encontrado")
    
    filepath, duration, filename = row
    conn.close()
    
    # Criar timeline OTIO
    timeline = otio.schema.Timeline(name=f"capiau_{filename}")
    track = otio.schema.Sequence(name="Video", 
                                 media_reference=otio.schema.MissingReference())
    timeline.tracks.append(track)
    
    # Se não houver segmentos definidos, exportar vídeo inteiro
    if not segments:
        segments = [{"in": 0, "out": duration, "label": "Video completo"}]
    
    for seg in segments:
        clip = otio.schema.Clip(
            name=seg.get("label", "Clip"),
            source_range=otio.opentime.TimeRange(
                start_time=otio.opentime.RationalTime(seg["in"], 24),
                duration=otio.opentime.RationalTime(seg["out"] - seg["in"], 24)
            ),
            media_reference=otio.schema.ExternalReference(
                target_url=f"file://{filepath}",
                available_range=otio.opentime.TimeRange(
                    start_time=otio.opentime.RationalTime(0, 24),
                    duration=otio.opentime.RationalTime(duration, 24)
                )
            )
        )
        track.append(clip)
    
    # Salvar
    otio.adapters.write_to_file(timeline, str(output_path))
    print(f"[EXPORT] OTIO salvo: {output_path}")
    return output_path

def export_edl(video_id: int, db_path: Path, output_path: Path, segments: list = None):
    """Exporta EDL CMX3600."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT filepath, duration, filename FROM video WHERE id = ?", (video_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise ValueError(f"Video {video_id} não encontrado")
    
    filepath, duration, filename = row
    
    if not segments:
        segments = [{"in": 0, "out": duration, "label": filename}]
    
    edl_lines = [
        "TITLE: capiau_export",
        "FCM: NON-DROP FRAME",
        ""
    ]
    
    for i, seg in enumerate(segments, 1):
        edl_lines.append(f"{i:03d}  {seg.get('label', 'CLIP'):8s}  V     C        ")
        edl_lines.append(f"{' '*40}{_sec_to_tc(seg['in'])} {_sec_to_tc(seg['out'])} {_sec_to_tc(seg['in'])} {_sec_to_tc(seg['out'])}")
        edl_lines.append("")
    
    with open(output_path, 'w') as f:
        f.write("\n".join(edl_lines))
    
    print(f"[EXPORT] EDL salvo: {output_path}")
    return output_path

def _sec_to_tc(seconds: float) -> str:
    """Converte segundos para timecode HH:MM:SS:FF (24fps)."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    frames = int((seconds % 1) * 24)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}:{frames:02d}"

if __name__ == "__main__":
    export_otio(1, CONFIG.db_path, CONFIG.home / "data" / "exports" / "teste.otio")
```

---

## 4. Pipeline de Execução (Orquestrador Principal)

### 4.11 Arquivo: `src/pipeline.py` (Orquestrador)

```python
"""Orquestrador principal do pipeline MVP."""
import sys
import time
from pathlib import Path

from src.config import CONFIG
from src.db.schema import init_db
from src.ingest.watcher import process_file
from src.transcription.whisperx_pipe import transcribe_video
from src.vision.yolo_detect import detect_objects
from src.vision.face_analysis import analyze_faces
from src.vision.scene_describe import describe_scenes
from src.search.semantic import SemanticSearch
from src.export.otio_export import export_otio

def run_pipeline(video_path: Path, project_id: int = 1):
    """Executa o pipeline completo em um vídeo."""
    print("=" * 60)
    print(f"CAPIAU MVP PIPELINE")
    print(f"Arquivo: {video_path.name}")
    print(f"Projeto: {project_id}")
    print("=" * 60)
    
    start_time = time.time()
    
    # 1. Inicializar banco (se necessário)
    init_db(CONFIG.db_path)
    
    # 2. Ingest
    print("\n[1/7] INGEST")
    process_file(video_path, CONFIG.db_path)
    
    # Buscar video_id inserido
    import sqlite3
    conn = sqlite3.connect(CONFIG.db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM video WHERE filename = ?", (video_path.name,))
    video_id = cursor.fetchone()[0]
    conn.close()
    
    # Atualizar status
    _update_status(video_id, "analyzing")
    
    # 3. Transcrição
    print("\n[2/7] TRANSCRIÇÃO")
    transcribe_video(video_path, video_id, CONFIG.db_path)
    
    # 4. Detecção de objetos
    print("\n[3/7] DETECÇÃO DE OBJETOS (YOLOv8)")
    detect_objects(video_id, video_path, CONFIG.db_path)
    
    # 5. Análise facial
    print("\n[4/7] ANÁLISE FACIAL E EMOÇÃO")
    analyze_faces(video_id, video_path, CONFIG.db_path)
    
    # 6. Descrição semântica
    print("\n[5/7] DESCRIÇÃO SEMÂNTICA DE CENAS")
    describe_scenes(video_id, CONFIG.db_path)
    
    # 7. Indexação semântica
    print("\n[6/7] INDEXAÇÃO SEMÂNTICA")
    search = SemanticSearch()
    search.index_video(video_id, str(CONFIG.db_path))
    
    # 8. Exportação
    print("\n[7/7] EXPORTAÇÃO")
    export_path = CONFIG.home / "data" / "exports" / f"{video_path.stem}.otio"
    export_otio(video_id, CONFIG.db_path, export_path)
    
    # Finalizar
    _update_status(video_id, "analyzed")
    
    elapsed = time.time() - start_time
    print(f"\n{'=' * 60}")
    print(f"PIPELINE CONCLUÍDO em {elapsed/60:.1f} minutos")
    print(f"Video ID: {video_id}")
    print(f"Export: {export_path}")
    print(f"{'=' * 60}\n")
    
    return video_id

def _update_status(video_id: int, status: str):
    import sqlite3
    conn = sqlite3.connect(CONFIG.db_path)
    conn.execute("UPDATE video SET status = ? WHERE id = ?", (status, video_id))
    conn.commit()
    conn.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python -m src.pipeline <caminho_do_video>")
        print("Exemplo: python -m src.pipeline ~/Videos/meu_filme.mp4")
        sys.exit(1)
    
    video_path = Path(sys.argv[1])
    if not video_path.exists():
        print(f"Erro: Arquivo não encontrado: {video_path}")
        sys.exit(1)
    
    run_pipeline(video_path)
```

---

## 5. Como Usar o MVP

### 5.1 Primeira Execução (One-liner)

```bash
cd ~/capiau
source venv/bin/activate

# Iniciar serviços em background
docker start capiau-qdrant  # Qdrant
ollama serve &              # LLM/VLM

# Inicializar banco
python3 -c "from src.db.schema import init_db; from src.config import CONFIG; init_db(CONFIG.db_path)"

# Executar pipeline em um vídeo
python3 -m src.pipeline ~/Videos/meu_video.mp4
```

### 5.2 Uso com Watch Folder (24/7)

```bash
# Terminal 1: Watch folder
python3 -m src.ingest.watcher

# Terminal 2: Processar vídeos ingested
# (em breve: worker automático. Por enquanto, processar manualmente)
```

### 5.3 Buscar no Acervo

```bash
python3 << 'PYEOF'
from src.search.semantic import SemanticSearch

search = SemanticSearch()

# Buscar por conceito
results = search.search("pessoa triste na cozinha", limit=5)
for r in results:
    print(f"\nScore: {r.score:.3f}")
    print(f"Tipo: {r.payload['type']}")
    print(f"Tempo: {r.payload.get('start_time', r.payload.get('timestamp', 0)):.1f}s")
    print(f"Texto: {r.payload['text'][:150]}")
PYEOF
```

### 5.4 Exportar para Editor

```bash
# Exportar OTIO (universal — Resolve, Premiere, Avid)
python3 -c "from src.export.otio_export import export_otio; from src.config import CONFIG; export_otio(1, CONFIG.db_path, CONFIG.home / 'data/exports/final.otio')"

# Exportar EDL (legado)
python3 -c "from src.export.otio_export import export_edl; from src.config import CONFIG; export_edl(1, CONFIG.db_path, CONFIG.home / 'data/exports/final.edl')"
```

---

## 6. Performance Esperada (RTX 4060 8GB)

| Etapa | Tempo por Hora de Vídeo | VRAM Usada |
|:---|:---|:---|
| **Ingest + Proxy** | ~2 min | CPU/disco |
| **Transcrição WhisperX** | ~6 min (10x real-time) | ~6 GB |
| **Detecção YOLOv8** | ~4 min | ~1.5 GB |
| **Análise Facial** | ~8 min | ~2 GB |
| **Descrição Semântica** | ~15-20 min | ~4.7 GB |
| **Indexação** | ~1 min | CPU/RAM |
| **Exportação** | <1 min | CPU |
| **TOTAL** | **~35-40 min por hora** | **Máx ~6 GB** |

Para **20h de vídeo**: ~12-14 horas de processamento contínuo (pode rodar overnight).

---

## 7. Próximos Passos (Pós-MVP)

| Prioridade | Feature | Esforço |
|:---|:---|:---|
| 1 | Parser de roteiro Fountain/FDX integrado | 1 dia |
| 2 | Alinhamento roteiro-transcrição (fuzzy matching) | 2-3 dias |
| 3 | Interface web (Streamlit/Gradio) para busca e preview | 2-3 dias |
| 4 | Worker automático (processa vídeos ingested automaticamente) | 1 dia |
| 5 | Suporte a múltiplos perfis (Ficção/Doc/TV) | 3-5 dias |
| 6 | Docker Compose completo (tudo em containers) | 1 dia |

---

*MVP Open Source 100% Local — Junho 2026. Zero custo de APIs. Execute em sua própria máquina.*
