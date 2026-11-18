"""Servidor REST FastAPI unificado e simplificado para o ecossistema CapIAu-Talho."""
import logging
import mimetypes
import os
import posixpath
from urllib.parse import unquote

# Corrigir mapeamento do registro do Windows que polui tipos MIME de imagem
mimetypes.add_type('image/jpeg', '.jpg')
mimetypes.add_type('image/jpeg', '.jpeg')

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from src.config import CONFIG
from src.api.security import (
    get_local_token,
    is_loopback_client,
    validate_local_host_and_origin,
)
from src.core.logging import setup_logging
from src.core.tasks import TASK_MANAGER
from src.db.schema import init_db
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.api.routes import projects, media, narrative, faces, entities, settings, scenes, modelos

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
    try:
        from src.navegador import orfaos as _nav_orfaos

        _nav_orfaos.varrer_orfaos()
    except Exception:
        pass
    yield
    print("[Shutdown] Limpando processos FFmpeg em execucao...")
    TASK_MANAGER.cleanup()
    try:
        from src.navegador import orfaos as _nav_orfaos

        _nav_orfaos.abortar_todos()
    except Exception:
        pass


app = FastAPI(
    title="CapIAu-Talho — Motor de Inteligência Cinematográfica",
    description="Backend modularizado com FastAPI, SQLite, Qdrant, FFmpeg Acelerado por GPU e Reconhecimento Facial em Cascata.",
    version="3.2",
    lifespan=lifespan,
)

_porta_cors = (os.getenv("PORT") or "8000").strip() or "8000"
ORIGENS_LOCAIS_CORS = [
    f"http://127.0.0.1:{_porta_cors}",
    f"http://localhost:{_porta_cors}",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENS_LOCAIS_CORS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_STATIC_MOUNT_PREFIXES = ("/cache", "/proxies", "/originals", "/exports")


def _is_blocked_static_dotfile_request(request: Request) -> bool:
    raw_path = request.scope.get("raw_path")
    candidates = [request.url.path]
    if isinstance(raw_path, (bytes, bytearray)) and raw_path:
        candidates.append(raw_path.decode("utf-8", errors="ignore"))
    for candidate in candidates:
        decoded = unquote(candidate).replace("\\", "/")
        normalized = posixpath.normpath(decoded)
        for prefix in _STATIC_MOUNT_PREFIXES:
            is_under_prefix = (
                decoded == prefix
                or decoded.startswith(prefix + "/")
                or normalized == prefix
                or normalized.startswith(prefix + "/")
            )
            if not is_under_prefix:
                continue
            rel = normalized[len(prefix):] if normalized.startswith(prefix) else decoded[len(prefix):]
            parts = [p for p in rel.split("/") if p and p != "."]
            if any(p == ".." or p.startswith(".") for p in parts):
                return True
            raw_parts = [p for p in decoded.split("/") if p]
            if any(p.startswith(".") for p in raw_parts):
                return True
    return False


@app.middleware("http")
async def add_cache_headers(request, call_next):
    if _is_blocked_static_dotfile_request(request):
        return JSONResponse({"detail": "Not found"}, status_code=404)
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
        if response.headers.get("Cache-Control") != "no-store":
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
app.include_router(modelos.router)

@app.get("/api/auth/local-token")
def get_auth_local_token(request: Request):
    """Emite o token local da sessão apenas para clientes loopback na mesma origem."""
    validate_local_host_and_origin(request)
    if not is_loopback_client(request):
        raise HTTPException(status_code=403, detail="Acesso restrito a clientes locais.")
    sec_fetch_site = (request.headers.get("sec-fetch-site") or "").strip().lower()
    if sec_fetch_site == "cross-site":
        raise HTTPException(status_code=403, detail="Requisição cross-site não permitida.")
    return JSONResponse(
        content={"token": get_local_token()},
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/health")
def get_health(request: Request):
    """Retorna o status de saúde do backend: SQLite, Qdrant, Hardware/GPU e porta em execução."""
    db_ok = False
    qdrant_outbox_pending = 0
    try:
        with get_db() as conn:
            conn.execute("SELECT 1")
            db_ok = True
            try:
                row = conn.execute(
                    "SELECT COUNT(*) FROM qdrant_outbox WHERE status = 'pending'"
                ).fetchone()
                qdrant_outbox_pending = int(row[0]) if row else 0
            except Exception:
                qdrant_outbox_pending = 0
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
        "qdrant_outbox_pending": qdrant_outbox_pending,
        "hardware": hw_info,
        "port": port
    }


app.mount("/proxies", StaticFiles(directory=str(CONFIG.PROXIES_DIR)), name="proxies")
app.mount("/originals", StaticFiles(directory=str(CONFIG.ORIGINALS_DIR)), name="originals")

exports_dir = CONFIG.EXPORTS_DIR
exports_dir.mkdir(parents=True, exist_ok=True)
app.mount("/exports", StaticFiles(directory=str(exports_dir)), name="exports")

class _CacheStaticFiles(StaticFiles):
    """Serve arquivos públicos de cache bloqueando dotfiles e .local_token."""

    async def get_response(self, path: str, scope):
        decoded = unquote(path or "").replace("\\", "/")
        normalized = posixpath.normpath(decoded)
        parts = [part for part in normalized.split("/") if part and part != "."]
        if any(part == ".." or part.startswith(".") for part in parts):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        return await super().get_response(path, scope)


cache_dir = CONFIG.CACHE_DIR
cache_dir.mkdir(parents=True, exist_ok=True)
app.mount("/cache", _CacheStaticFiles(directory=str(cache_dir)), name="cache")


# Interface Web na raiz do servidor
frontend_dir = CONFIG.BASE_DIR / "src/ui"
frontend_dir.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="ui")
# Auto-reload trigger comment v3 (adaptadores OTIO fcp_xml + cmx_3600 instalados)


if __name__ == "__main__":
    import uvicorn

    host = (os.getenv("CAPIAU_HOST") or "127.0.0.1").strip() or "127.0.0.1"
    port = int((os.getenv("PORT") or "8000").strip() or "8000")
    uvicorn.run("src.api.server:app", host=host, port=port)
