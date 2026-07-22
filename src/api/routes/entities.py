"""Rotas FastAPI para a Camada de Entidades (Pessoas, Objetos, Locações) e Enriquecimento de Descrições."""
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks

from src.db.connection import get_db
from src.db.repositories.entities import EntityRepository
from src.nlp.enrichment_engine import (
    enrich_project,
    enrich_photo,
    enrich_video_frames,
    enrich_in_background
)

router = APIRouter(prefix="/api/entities", tags=["Entities"])


class EntityCreate(BaseModel):
    project_id: int
    name: str
    entity_type: str = "other"  # person | object | location | other
    description: str = ""


class EntityUpdate(BaseModel):
    name: Optional[str] = None
    entity_type: Optional[str] = None
    description: Optional[str] = None
    role: Optional[str] = None
    realm: Optional[str] = None
    linked_entity_id: Optional[int] = None
    aliases: Optional[List[str]] = None


@router.get("/project/{project_id}")
def list_project_entities(
    project_id: int,
    status: Optional[str] = Query(None, description="Filtra por status: 'suggested' (fila de curadoria do roteiro), 'confirmed' ou 'rejected'."),
):
    """Lista as entidades do projeto com contagem de menções."""
    with get_db() as conn:
        return {"entities": EntityRepository.list_entities(conn, project_id, status=status)}


@router.post("")
def create_entity(payload: EntityCreate):
    """Cria manualmente uma entidade (ex: cadastrar equipamento antes da análise)."""
    if payload.entity_type not in ("person", "object", "location", "other"):
        raise HTTPException(status_code=400, detail="entity_type inválido.")
    with get_db() as conn:
        entity_id = EntityRepository.upsert_entity(
            conn, payload.project_id, payload.name, payload.entity_type, payload.description
        )
        conn.commit()
    return {"status": "success", "entity_id": entity_id}


@router.patch("/{entity_id}")
def update_entity(entity_id: int, payload: EntityUpdate):
    """Edita uma entidade: nome/tipo/descrição/função/universo/vínculo/aliases.

    Convenção de UI (E-B): renomear uma pessoa 'production' (equipe/elenco real)
    deve ir por POST /api/faces/project/{id}/rename-name, não por aqui — aquela rota
    sincroniza face+person+transcript+entity+Qdrant; esta só toca a entidade e
    re-enriquece o texto. Esta rota é o caminho certo para: renomear entidades que
    não têm rosto (objeto, locação, personagem 'story'), e para editar os campos
    novos (description/role/realm/linked_entity_id/aliases) de qualquer entidade.

    Só os campos ENVIADOS no payload são alterados — `linked_entity_id: null` é a
    ação real de desvincular, distinta de omitir o campo (exclude_unset).
    """
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")

    if "entity_type" in updates and updates["entity_type"] not in ("person", "object", "location", "other"):
        raise HTTPException(status_code=400, detail="entity_type inválido.")
    if "realm" in updates and updates["realm"] not in ("production", "story"):
        raise HTTPException(status_code=400, detail="realm inválido (use 'production' ou 'story').")
    if updates.get("name") is not None and not updates["name"].strip():
        raise HTTPException(status_code=400, detail="Nome não pode ser vazio.")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, project_id FROM entity WHERE id = ?", (entity_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entidade não encontrada.")
        project_id = row["project_id"]

        if updates.get("linked_entity_id") is not None:
            cursor.execute(
                "SELECT 1 FROM entity WHERE id = ? AND project_id = ?",
                (updates["linked_entity_id"], project_id)
            )
            if not cursor.fetchone():
                raise HTTPException(status_code=400, detail="linked_entity_id não pertence a este projeto.")

        EntityRepository.update_entity_fields(conn, entity_id, **updates)
        # Nome/tipo influenciam o texto das descrições geradas; os demais campos novos
        # (role/realm/linked_entity_id/aliases) não aparecem em nenhuma descrição, então
        # não justificam re-enriquecer mídia.
        affected = []
        if "name" in updates or "entity_type" in updates:
            affected = EntityRepository.get_affected_media(conn, entity_id)
        conn.commit()

    if affected:
        def _reenrich():
            for media in affected:
                if media.get("photo_id"):
                    enrich_photo(project_id, media["photo_id"])
                elif media.get("video_id") and media.get("timestamp") is not None:
                    enrich_video_frames(project_id, media["video_id"], [media["timestamp"]])

        enrich_in_background(_reenrich)
    return {"status": "success", "affected_media": len(affected)}


@router.delete("/{entity_id}")
def delete_entity(entity_id: int):
    """Remove uma entidade e suas menções."""
    with get_db() as conn:
        EntityRepository.delete_entity(conn, entity_id)
        conn.commit()
    return {"status": "success"}


class BulkEntityStatusPayload(BaseModel):
    project_id: int
    entity_ids: List[int]
    status: str  # suggested | confirmed | rejected


@router.post("/bulk-status")
def bulk_entity_status(payload: BulkEntityStatusPayload):
    """Aceita/rejeita entidades sugeridas pela extração de roteiro em massa (P2.5).
    Só entidades 'confirmed' entram nos prompts de visão/triagem (get_known_names)."""
    if payload.status not in ("suggested", "confirmed", "rejected"):
        raise HTTPException(status_code=400, detail="Status inválido para entidade.")
    with get_db() as conn:
        n = EntityRepository.set_entities_status(conn, payload.project_id, payload.entity_ids, payload.status)
        conn.commit()
    return {"status": "success", "updated": n}


class MergeEntitiesPayload(BaseModel):
    project_id: int
    source_id: int  # some (é apagada)
    target_id: int  # sobrevive (recebe menções + alias)


@router.post("/merge")
def merge_entities_endpoint(payload: MergeEntitiesPayload):
    """Funde duas entidades (E-A2): `source` some, `target` sobrevive com as menções
    e o nome antigo como alias. Sem bloqueio de tipo/universo incompatível no backend
    — o aviso é do frontend (ex: 'isto é um objeto sendo fundido com uma pessoa,
    confirma?'), a decisão final é do usuário."""
    with get_db() as conn:
        try:
            result = EntityRepository.merge_entities(conn, payload.project_id, payload.source_id, payload.target_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        conn.commit()
    return {"status": "success", **result}


@router.post("/project/{project_id}/enrich")
def trigger_project_enrichment(
    project_id: int,
    video_id: Optional[int] = Query(None, description="Restringe o enriquecimento a um único vídeo"),
    photo_id: Optional[int] = Query(None, description="Restringe o enriquecimento a uma única foto")
):
    """Dispara o re-enriquecimento das descrições: reescreve com os nomes confirmados
    (LLM) e reindexa os embeddings no Qdrant. Sem parâmetros = projeto inteiro."""
    from src.core.tasks import TASK_MANAGER
    if video_id is not None:
        TASK_MANAGER.executor.submit(enrich_video_frames, project_id, video_id)
        scope = f"vídeo {video_id}"
    elif photo_id is not None:
        TASK_MANAGER.executor.submit(enrich_photo, project_id, photo_id)
        scope = f"foto {photo_id}"
    else:
        TASK_MANAGER.executor.submit(enrich_project, project_id)
        scope = "projeto inteiro"
    return {
        "status": "success",
        "message": f"Enriquecimento iniciado em background ({scope}). As descrições serão reescritas com os nomes confirmados e reindexadas."
    }


@router.post("/project/{project_id}/backfill-legacy")
def backfill_legacy_labels(project_id: int):
    """Migra rotulagens legadas (face.name e hack 'text:') para a camada de entidades.

    Cria entity + entity_mention para cada face nomeada existente — necessário uma única
    vez em projetos que já tinham rostos rotulados antes da camada de entidades.
    """
    created_entities = 0
    created_mentions = 0
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, crop_path, photo_id, video_id, timestamp FROM face
            WHERE project_id = ? AND name IS NOT NULL AND name != ''
              AND name NOT IN ('Não Relevante', 'Não é Rosto')
        """, (project_id,))
        rows = cursor.fetchall()

        seen_entities = set()
        for r in rows:
            crop = r["crop_path"] or ""
            is_text_link = crop.startswith("text:")
            etype = "object" if is_text_link else "person"
            entity_id = EntityRepository.upsert_entity(conn, project_id, r["name"], etype)
            if entity_id not in seen_entities:
                seen_entities.add(entity_id)
                created_entities += 1
            EntityRepository.add_mention(
                conn, entity_id, project_id,
                photo_id=r["photo_id"], video_id=r["video_id"], timestamp=r["timestamp"],
                source="text_link" if is_text_link else "face_recognition",
                status="confirmed",
                text_to_replace=crop[5:] if is_text_link else None
            )
            created_mentions += 1
        conn.commit()

    return {
        "status": "success",
        "entities": created_entities,
        "mentions": created_mentions,
        "message": f"{created_entities} entidades e {created_mentions} menções migradas do legado. Use /enrich para reescrever as descrições."
    }
