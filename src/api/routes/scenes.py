"""Rotas FastAPI para extração estruturada de roteiro e curadoria de cenas (P2)."""
import sqlite3
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Depends

from src.api.dependencies import get_db_conn
from src.core.tasks import TASK_MANAGER
from src.db.repositories.projects import ProjectRepository
from src.db.repositories.scenes import SceneRepository
from src.services.script_extract import run_script_extraction, extraction_task_key
from src.services.script_format import detect_structure, detect_structure_for_project

router = APIRouter(tags=["Scenes"])


class BulkScenesStatusPayload(BaseModel):
    project_id: int
    scene_ids: List[int]
    status: str  # suggested | confirmed | rejected


def _get_doc_or_404(conn: sqlite3.Connection, project_id: int, doc_id: int):
    if not ProjectRepository.document_belongs_to_project(conn, project_id, doc_id):
        raise HTTPException(status_code=404, detail="Documento não encontrado neste projeto.")
    doc = ProjectRepository.get_document(conn, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")
    return doc


@router.get("/api/docs/{doc_id}/structure-preview")
def structure_preview(
    doc_id: int, project_id: int = Query(...),
    llm: bool = Query(False, description="Se true, usa a camada 3 (LLM) quando as heurísticas locais falharem."),
    conn: sqlite3.Connection = Depends(get_db_conn),
):
    """Roda a detecção de formato do roteiro sem gastar API (a menos que llm=true),
    para o usuário confirmar a estratégia antes de disparar a extração de verdade."""
    doc = _get_doc_or_404(conn, project_id, doc_id)

    if llm:
        report = detect_structure_for_project(doc["content"] or "", doc["filename"], project_id)
    else:
        from src.services.settings_service import SettingsService
        S = SettingsService.get_settings(project_id)
        report = detect_structure(
            doc["content"] or "", filename=doc["filename"], project_id=project_id,
            forced_strategy=S.get("script.anchor_strategy"),
            min_coverage=S.get("script.min_coverage"),
            max_median_chars=S.get("script.max_median_chars"),
            max_scene_ratio=S.get("script.max_scene_ratio"),
            allow_llm=False,
        )
    return report.to_dict()


@router.post("/api/docs/{doc_id}/extract-structure")
def extract_structure(
    doc_id: int, background_tasks: BackgroundTasks,
    project_id: int = Query(...),
    force: bool = Query(False, description="Reextrai mesmo se já houver uma rodada 'done' para esta versão do texto."),
    conn: sqlite3.Connection = Depends(get_db_conn),
):
    """Dispara a extração estruturada em background. IO-bound (chamadas HTTP
    sequenciais ao modelo de texto) — seguro no threadpool do BackgroundTasks,
    diferente do lote de visão (que sufoca o event loop)."""
    _get_doc_or_404(conn, project_id, doc_id)

    task_key = extraction_task_key(doc_id)
    current = TASK_MANAGER.get_progress().get(task_key)
    if current and current.get("status") == "running":
        raise HTTPException(status_code=409, detail="Já existe uma extração deste roteiro em andamento.")

    background_tasks.add_task(run_script_extraction, project_id, doc_id, force)
    return {"status": "success", "message": "Extração estruturada do roteiro iniciada em background."}


@router.get("/api/docs/{doc_id}/extraction")
def get_extraction_status(doc_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Última rodada de extração deste documento (status, custo, estratégia usada)."""
    last = SceneRepository.latest_extraction(conn, doc_id)
    return last or {"status": "none"}


@router.get("/api/project/{project_id}/scenes")
def list_project_scenes(
    project_id: int, doc_id: Optional[int] = None, include_rejected: bool = False,
    conn: sqlite3.Connection = Depends(get_db_conn),
):
    scenes = SceneRepository.list_scenes(conn, project_id, doc_id=doc_id, include_rejected=include_rejected)
    return {"scenes": scenes}


@router.post("/api/scenes/bulk-status")
def bulk_scene_status(payload: BulkScenesStatusPayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Aceita/rejeita cenas sugeridas em massa (curadoria da aba Docs)."""
    if payload.status not in ("suggested", "confirmed", "rejected"):
        raise HTTPException(status_code=400, detail="Status inválido para cena.")
    n = SceneRepository.set_scenes_status(conn, payload.project_id, payload.scene_ids, payload.status)
    conn.commit()
    return {"status": "success", "updated": n}
