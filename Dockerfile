# ==============================================================================
# CapIAu-Talho — Dockerfile (Python 3.12 + FFmpeg + CPU AI Pipeline)
# ==============================================================================
FROM python:3.12-slim-bookworm

# Evitar prompts interativos do apt e buffers do Python
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

# Instalar dependências de sistema essenciais (FFmpeg, bibliotecas gráficas para OpenCV e utilitários)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar PyTorch CPU otimizado para economizar espaço e tempo de build
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Copiar manifesto de dependências e instalar pacotes Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Criar estrutura básica de diretórios persistentes
RUN mkdir -p /app/data/originals \
             /app/data/proxies/thumbnails \
             /app/data/proxies/photos \
             /app/data/cache \
             /app/data/exports \
             /app/data/models \
             /app/watch

# Copiar o código-fonte da aplicação
COPY src/ /app/src/
COPY scripts/ /app/scripts/
COPY pytest.ini /app/pytest.ini
COPY .env.example /app/.env.example

# Expor porta padrão do servidor FastAPI
EXPOSE 8000

# Checagem de integridade do container
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Comando de inicialização padrão
CMD ["uvicorn", "src.api.server:app", "--host", "0.0.0.0", "--port", "8000"]
