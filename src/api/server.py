"""Servidor REST FastAPI unificado e simplificado para o ecossistema CapIAu-Talho."""
import logging
import mimetypes

# Corrigir mapeamento do registro do Windows que polui tipos MIME de imagem
mimetypes.add_type('image/jpeg', '.jpg')
mimetypes.add_type('image/jpeg', '.jpeg')

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.config import CONFIG
from src.core.logging import setup_logging
from src.core.tasks import TASK_MANAGER
from src.db.schema import init_db
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.api.routes import projects, media, narrative, faces, entities, settings

# Silencia polling logs repetitivos do uvicorn no terminal
class EndpointFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "/api/conversions" not in msg and "/api/videos" not in msg and "/api/faces" not in msg

logging.getLogger("uvicorn.access").addFilter(EndpointFilter())

# Configura logger raiz e inicia/corrige banco relacional SQLite
setup_logging()
init_db()

with get_db() as conn:
    MediaRepository.reset_stuck_tasks(conn)
    conn.commit()

app = FastAPI(
    title="CapIAu-Talho — Motor de Inteligência Cinematográfica",
    description="Backend modularizado com FastAPI, SQLite, Qdrant, FFmpeg em CPU e Reconhecimento Facial em Cascata.",
    version="3.1"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_cache_headers(request, call_next):
    response = await call_next(request)
    path = request.url.path
    # Mídia pesada (thumbnails de rostos, proxies, originais) PODE e DEVE ser cacheada pelo
    # navegador. Sem isso, cada reabertura de "Gerenciar Rostos" re-baixava centenas de
    # thumbnails e re-transmitia proxies do zero, saturando o servidor de worker único.
    is_media = (
        path.startswith("/proxies")
        or path.startswith("/originals")
        or path.endswith("/thumbnail")
    )
    if is_media:
        # Respeita o Cache-Control que a própria rota já definiu; caso contrário aplica um padrão.
        response.headers.setdefault("Cache-Control", "public, max-age=604800")
    else:
        # HTML/JS/JSON continuam sem cache para refletir mudanças imediatamente.
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Acoplamento de rotas modulares
app.include_router(projects.router)
app.include_router(media.router)
app.include_router(narrative.router)
app.include_router(faces.router)
app.include_router(entities.router)
app.include_router(settings.router)

from fastapi import Request

@app.get("/api/health")
def get_health(request: Request):
    """Retorna o status de saúde do backend: SQLite, Qdrant e porta em execução."""
    db_ok = False
    try:
        with get_db() as conn:
            conn.execute("SELECT 1")
            db_ok = True
    except Exception:
        db_ok = False

    qdrant_ok = False
    qdrant_err = None
    try:
        from src.search.semantic import SemanticSearch
        is_avail, err_msg = SemanticSearch.get_instance().check_health()
        qdrant_ok = is_avail
        qdrant_err = err_msg
    except Exception as e:
        qdrant_ok = False
        qdrant_err = str(e)

    port = request.url.port or 8000
    status = "ok" if (db_ok and qdrant_ok) else "degraded"

    return {
        "status": status,
        "db": "ok" if db_ok else "error",
        "qdrant": "ok" if qdrant_ok else "unavailable",
        "qdrant_error": qdrant_err,
        "port": port
    }

@app.on_event("shutdown")
def on_shutdown_cleanup() -> None:
    """Callback disparado no desligamento do servidor para matar processos orfaos."""
    print("[Shutdown] Limpando processos FFmpeg em execucao...")
    TASK_MANAGER.cleanup()

# Montagem de endpoints para arquivos estáticos locais (player/visualizacao)
app.mount("/proxies", StaticFiles(directory=str(CONFIG.PROXIES_DIR)), name="proxies")
app.mount("/originals", StaticFiles(directory=str(CONFIG.ORIGINALS_DIR)), name="originals")

cache_dir = CONFIG.BASE_DIR / "data/cache"
cache_dir.mkdir(parents=True, exist_ok=True)
app.mount("/cache", StaticFiles(directory=str(cache_dir)), name="cache")


# Interface Web na raiz do servidor
frontend_dir = CONFIG.BASE_DIR / "src/ui"
frontend_dir.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="ui")
# Auto-reload trigger comment v3 (adaptadores OTIO fcp_xml + cmx_3600 instalados)
