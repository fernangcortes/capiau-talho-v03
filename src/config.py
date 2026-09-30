"""Configurações centralizadas do CapIAu-Talho MVP."""
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
    # IDs conferidos na lista ao vivo da OpenRouter (/api/v1/models) em 30/09/2026.
    # Um ID que não existe lá faz toda chamada falhar e cair no assistente local.
    TEXT_MODEL = os.getenv("TEXT_MODEL", "deepseek/deepseek-v4.1-flash")
    TEXT_MODELS = [
        "deepseek/deepseek-v4.1-flash",
        "~deepseek/deepseek-flash-latest",
        "deepseek/deepseek-v4-pro",
        "google/gemini-3.8-flash",
        "anthropic/claude-sonnet-5.5",
        "openai/gpt-5.5",
        "deepseek/deepseek-v4-flash",
    ]
    # Nome legível de cada ID, mostrado nas listas das Configurações.
    MODEL_LABELS = {
        "deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash (rápido e barato)",
        "~deepseek/deepseek-flash-latest": "DeepSeek Flash, sempre o mais novo",
        "deepseek/deepseek-v4-pro": "DeepSeek V4 Pro (mais qualidade, mais caro)",
        "deepseek/deepseek-v4-flash": "DeepSeek V4 Flash (geração anterior)",
        "google/gemini-2.5-flash": "Gemini 2.5 Flash",
        "google/gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
        "google/gemini-3.5-flash": "Gemini 3.5 Flash",
        "google/gemini-3.8-flash": "Gemini 3.8 Flash",
        "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro (prévia)",
        "anthropic/claude-sonnet-5.5": "Claude Sonnet 5.5",
        "anthropic/claude-fable-5.1": "Claude Fable 5.1",
        "openai/gpt-5.5": "GPT-5.5",
        "openai/gpt-4o-mini": "GPT-4o mini",
        "perceptron/perceptron-mk1": "Perceptron MK1",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": "Nemotron 3 Nano Omni (grátis)",
    }
    # Padrão pago e confiável, com um gratuito como reserva (ver VISION_MODEL_FALLBACK).
    # Testado ao vivo em 17/07/2026 com o Nemotron como principal: qualidade equivalente
    # ao Gemini em amostra pequena, mas em produção real ~30% das chamadas bateram em
    # "Upstream idle timeout exceeded" (504, o próprio gateway da OpenRouter esperando o
    # upstream do modelo ':free') -- isso sozinho projetava ~5,7 dias só p/ as fotos
    # restantes, contra poucas horas com o Gemini. Decisão do usuário: Gemini de volta
    # como padrão; o Nemotron continua selecionável (dropdown) e como reserva.
    VISION_MODEL = os.getenv("VISION_MODEL", "google/gemini-2.5-flash")
    VISION_MODEL_FALLBACK = os.getenv("VISION_MODEL_FALLBACK", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free")
    VISION_MAX_RETRIES = int(os.getenv("VISION_MAX_RETRIES", "2"))
    # Opções gratuitas ficam por último de propósito: rate limit da OpenRouter é
    # 20 req/min sempre, e 1000/dia só com >= US$10 em compras acumuladas na conta
    # (senão 50/dia) — vale conferir isso antes de escolher uma delas para um lote
    # grande. DeepSeek NÃO aparece aqui: nenhum modelo da linha aceita imagem hoje
    # na OpenRouter (conferido ao vivo em 17/07/2026).
    VISION_MODELS = [
        "google/gemini-2.5-flash",
        "google/gemini-3.8-flash",
        "google/gemini-3.1-pro-preview",
        "google/gemini-3.1-flash-lite",
        "perceptron/perceptron-mk1",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    ]
    
    # ── Configurações do Agente de Edição (Fase 1 - Julho 2026) ──
    AGENT_MODEL = os.getenv("AGENT_MODEL", "deepseek/deepseek-v4.1-flash")
    AGENT_MODELS = [
        "deepseek/deepseek-v4.1-flash",
        "deepseek/deepseek-v4-pro",
        "google/gemini-3.8-flash",
        "google/gemini-3.5-flash",
        "google/gemini-3.1-pro-preview",
        "anthropic/claude-sonnet-5.5",
        "anthropic/claude-fable-5.1",
        "openai/gpt-4o-mini",
        "deepseek/deepseek-v4-flash",
    ]
    
    # ── Paths locais ───────────────────────────────────────────
    BASE_DIR = Path(__file__).resolve().parent.parent
    
    DB_PATH = BASE_DIR / os.getenv("capiau_DB", "data/capiau.db")
    WATCH_FOLDER = BASE_DIR / os.getenv("capiau_WATCH", "watch")
    ORIGINALS_DIR = BASE_DIR / os.getenv("capiau_ORIGINALS", "data/originals")
    PROXIES_DIR = BASE_DIR / os.getenv("capiau_PROXIES", "data/proxies")
    CACHE_DIR = BASE_DIR / os.getenv("capiau_CACHE", "data/cache")
    WAVEFORMS_DIR = CACHE_DIR / "waveforms"
    EXPORTS_DIR = BASE_DIR / os.getenv("capiau_EXPORTS", "data/exports")
    QDRANT_DB_PATH = BASE_DIR / os.getenv("capiau_QDRANT_DB", "data/qdrant.db")
    THUMBNAILS_DIR = PROXIES_DIR / "thumbnails"
    
    # ── Configurações de Ingestão e Proxy ──────────────────────
    MAX_CONVERSION_WORKERS = int(os.getenv("MAX_CONVERSION_WORKERS", "2"))
    PROXY_RESOLUTION = "1280x720" # HD 720p para preview suave
    PROXY_CRF = 23
    PROXY_PRESET = "fast"
    FRAME_INTERVAL = 10  # Extrair frame a cada 10 segundos para visão multimodal
    # Duração padrão (segundos) de uma foto (still) ao ser inserida na timeline.
    PHOTO_DEFAULT_DURATION = 5.0
    # Modelo de embeddings local (384 dims). O multilíngue entende Português de verdade;
    # o antigo all-MiniLM-L6-v2 é focado em inglês e ranqueava mal buscas em PT.
    # Após trocar de modelo, rode POST /api/search/reindex para re-embedar o acervo.
    embedding_model = os.getenv("EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
    
    def __init__(self):
        # Garantir a criação de todos os diretórios físicos necessários
        for directory in [
            self.WATCH_FOLDER,
            self.ORIGINALS_DIR,
            self.PROXIES_DIR,
            self.PROXIES_DIR / "photos",
            self.THUMBNAILS_DIR,
            self.CACHE_DIR,
            self.WAVEFORMS_DIR,
            self.EXPORTS_DIR,
            self.QDRANT_DB_PATH.parent,
            self.DB_PATH.parent
        ]:
            directory.mkdir(parents=True, exist_ok=True)

            
CONFIG = Config()
