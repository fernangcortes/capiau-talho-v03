"""Servidor REST FastAPI unificado e simplificado para o ecossistema CapIAu-Talho."""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.config import CONFIG
from src.core.logging import setup_logging
from src.core.tasks import TASK_MANAGER
from src.db.schema import init_db
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.api.routes import projects, media, narrative, faces

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

# Acoplamento de rotas modulares
app.include_router(projects.router)
app.include_router(media.router)
app.include_router(narrative.router)
app.include_router(faces.router)

@app.on_event("shutdown")
def on_shutdown_cleanup() -> None:
    """Callback disparado no desligamento do servidor para matar processos orfaos."""
    print("[Shutdown] Limpando processos FFmpeg em execucao...")
    TASK_MANAGER.cleanup()

# Montagem de endpoints para arquivos estáticos locais (player/visualizacao)
app.mount("/proxies", StaticFiles(directory=str(CONFIG.PROXIES_DIR)), name="proxies")
app.mount("/originals", StaticFiles(directory=str(CONFIG.ORIGINALS_DIR)), name="originals")

# Interface Web na raiz do servidor
frontend_dir = CONFIG.BASE_DIR / "src/ui"
frontend_dir.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="ui")
# Auto-reload trigger comment v2
