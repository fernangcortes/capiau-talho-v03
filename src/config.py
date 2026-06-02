"""Configurações centralizadas do CapIAu MVP."""
import os
from pathlib import Path
from dotenv import load_dotenv

# Carregar variáveis de ambiente do arquivo .env
load_dotenv()

class Config:
    # ── API Keys ───────────────────────────────────────────────
    OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
    ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY", "")
    
    # ── Modelos OpenRouter (Customizáveis via .env) ─────────────
    # Modelos recomendados em 2026:
    # Texto/Clustering: deepseek/deepseek-chat, minimax/minimax-m3, qwen/qwen-3.7-max, openai/gpt-5.5
    # Visão/Frames: google/gemini-2.5-flash, google/gemini-3.1-flash-lite, perceptron/perceptron-mk1
    TEXT_MODEL = os.getenv("TEXT_MODEL", "deepseek/deepseek-chat")
    VISION_MODEL = os.getenv("VISION_MODEL", "google/gemini-2.5-flash")
    
    # ── Paths locais ───────────────────────────────────────────
    BASE_DIR = Path(__file__).resolve().parent.parent
    
    DB_PATH = BASE_DIR / os.getenv("capiau_DB", "data/capiau.db")
    WATCH_FOLDER = BASE_DIR / os.getenv("capiau_WATCH", "watch")
    ORIGINALS_DIR = BASE_DIR / os.getenv("capiau_ORIGINALS", "data/originals")
    PROXIES_DIR = BASE_DIR / os.getenv("capiau_PROXIES", "data/proxies")
    CACHE_DIR = BASE_DIR / os.getenv("capiau_CACHE", "data/cache")
    EXPORTS_DIR = BASE_DIR / os.getenv("capiau_EXPORTS", "data/exports")
    QDRANT_DB_PATH = BASE_DIR / os.getenv("capiau_QDRANT_DB", "data/qdrant.db")
    
    # ── Configurações de Ingestão e Proxy ──────────────────────
    PROXY_RESOLUTION = "1280x720" # HD 720p para preview suave
    PROXY_CRF = 23
    PROXY_PRESET = "fast"
    FRAME_INTERVAL = 10  # Extrair frame a cada 10 segundos para visão multimodal
    embedding_model = "sentence-transformers/all-MiniLM-L6-v2"
    
    def __init__(self):
        # Garantir a criação de todos os diretórios físicos necessários
        for directory in [
            self.WATCH_FOLDER,
            self.ORIGINALS_DIR,
            self.PROXIES_DIR,
            self.CACHE_DIR,
            self.EXPORTS_DIR,
            self.QDRANT_DB_PATH.parent,
            self.DB_PATH.parent
        ]:
            directory.mkdir(parents=True, exist_ok=True)
            
CONFIG = Config()
