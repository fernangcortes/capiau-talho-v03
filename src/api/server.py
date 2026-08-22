"""Servidor REST FastAPI unificado e simplificado para o ecossistema CapIAu-Talho."""
import logging
import mimetypes

# Corrigir mapeamento do registro do Windows que polui tipos MIME de imagem
mimetypes.add_type('image/jpeg', '.jpg')
mimetypes.add_type('image/jpeg', '.jpeg')

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.config import CONFIG
from src.core.logging import setup_logging
from src.core.tasks import TASK_MANAGER
from src.db.schema import init_db
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.api.routes import projects, media, narrative, faces, entities, settings, scenes

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


try:
    import cv2
    from src.services.settings_service import SettingsService
    s_opencl = SettingsService.get_settings().get("hardware.opencv_opencl")
    if s_opencl and cv2.ocl.haveOpenCL():
        cv2.ocl.setUseOpenCL(True)
        dev = cv2.ocl.Device.getDefault()
        print(f"[Hardware] OpenCV OpenCL ativado na GPU: {dev.name()} ({dev.vendorName()})")
    else:
        cv2.ocl.setUseOpenCL(False)
except Exception as e:
    print(f"[Hardware] Aviso OpenCL: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    print("[Shutdown] Limpando processos FFmpeg em execucao...")
    TASK_MANAGER.cleanup()


app = FastAPI(
    title="CapIAu-Talho — Motor de Inteligência Cinematográfica",
    description="Backend modularizado com FastAPI, SQLite, Qdrant, FFmpeg Acelerado por GPU e Reconhecimento Facial em Cascata.",
    version="3.2",
    lifespan=lifespan,
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
app.include_router(scenes.router)

from fastapi import Request

@app.get("/api/health")
def get_health(request: Request):
    """Retorna o status de saúde do backend: SQLite, Qdrant, Hardware/GPU e porta em execução."""
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

    # Diagnóstico de Hardware e GPU
    hw_info = {
        "opencl_available": False,
        "opencl_device": None,
        "hw_encoders": {}
    }
    try:
        import cv2
        hw_info["opencl_available"] = bool(cv2.ocl.haveOpenCL())
        if cv2.ocl.haveOpenCL():
            dev = cv2.ocl.Device.getDefault()
            hw_info["opencl_device"] = f"{dev.name()} ({dev.vendorName()})"
        from src.media.ffmpeg import get_available_hw_encoders
        hw_info["hw_encoders"] = get_available_hw_encoders()
    except Exception:
        pass

    port = request.url.port or 8000
    status = "ok" if (db_ok and qdrant_ok) else "degraded"

    return {
        "status": status,
        "db": "ok" if db_ok else "error",
        "qdrant": "ok" if qdrant_ok else "unavailable",
        "qdrant_error": qdrant_err,
        "hardware": hw_info,
        "port": port
    }


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
