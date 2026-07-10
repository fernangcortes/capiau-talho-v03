"""Roteador FastAPI do Painel de Configurações da IA (registry, overrides, presets)."""
import sqlite3
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.dependencies import get_db_conn
from src.api.schemas import SettingsUpdatePayload, SettingsResetPayload, PresetApplyPayload, PromptUpdatePayload
from src.db.repositories.settings import SettingsRepository
from src.services.settings_service import SettingsService
from src.services.settings_registry import (
    SETTINGS_REGISTRY,
    CATEGORIES,
    PRESETS,
    get_registry_map,
    validate_value,
    mask_secret,
)

router = APIRouter(tags=["AI Settings"])


def _validate_payload(values: dict, scope: str) -> dict:
    """Valida/coage todos os valores do payload; levanta 422 no primeiro erro.

    Secrets vazios ou iguais à máscara são descartados silenciosamente (o input
    de senha da UI fica vazio com a máscara como placeholder — só grava se o
    usuário digitou uma chave nova). Chaves global-only são rejeitadas no escopo projeto.
    """
    registry = get_registry_map()
    coerced_values = {}
    for key, raw in values.items():
        entry = registry.get(key)
        if entry is None:
            raise HTTPException(422, f"Configuração desconhecida: '{key}'")
        if scope == "project" and entry.get("scope") == "global":
            raise HTTPException(422, f"'{key}' só pode ser configurada no escopo global")
        if entry["type"] == "secret":
            # Nunca ecoar o valor em erros nem gravar máscaras/vazios
            if not isinstance(raw, str) or not raw.strip() or "…" in raw or raw.strip() == "•••":
                continue
            coerced_values[key] = raw.strip()
            continue
        ok, result = validate_value(key, raw)
        if not ok:
            raise HTTPException(422, result)
        coerced_values[key] = result
    return coerced_values


# ── Leitura ──────────────────────────────────────────────────────────────────

@router.get("/api/settings/registry")
def get_settings_registry():
    """Metadados do catálogo (sem valores): o painel da UI se auto-gera a partir daqui."""
    # Não expõe defaults de secrets (são sempre vazios, mas por consistência)
    entries = []
    for e in SETTINGS_REGISTRY:
        entry = dict(e)
        if entry["type"] == "secret":
            entry["default"] = ""
        entries.append(entry)
    presets = {
        pid: {"label": p["label"], "description": p["description"], "keys": sorted(p["values"].keys())}
        for pid, p in PRESETS.items()
    }
    return {"status": "success", "settings": entries, "categories": CATEGORIES, "presets": presets}


@router.get("/api/settings")
def get_settings(project_id: Optional[int] = Query(None)):
    """Valores resolvidos (default -> global -> projeto) com origem de cada um. Secrets mascarados."""
    try:
        resolved = SettingsService.get_resolved_with_origin(project_id)
        active_preset = SettingsService.detect_active_preset(project_id)
        return {
            "status": "success",
            "project_id": project_id,
            "values": resolved,
            "active_preset": active_preset,
        }
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Escrita ──────────────────────────────────────────────────────────────────

@router.put("/api/settings/global")
def update_global_settings(payload: SettingsUpdatePayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Grava overrides globais (apenas as chaves enviadas)."""
    coerced = _validate_payload(payload.values, scope="global")
    try:
        for key, value in coerced.items():
            SettingsRepository.upsert_global(conn, key, value)
        conn.commit()
        SettingsService.invalidate()
        return {"status": "success", "updated": sorted(coerced.keys())}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.put("/api/settings/project/{project_id}")
def update_project_settings(project_id: int, payload: SettingsUpdatePayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Grava overrides do projeto (apenas as chaves enviadas)."""
    coerced = _validate_payload(payload.values, scope="project")
    try:
        for key, value in coerced.items():
            SettingsRepository.upsert_project(conn, project_id, key, value)
        conn.commit()
        SettingsService.invalidate(project_id)
        return {"status": "success", "updated": sorted(coerced.keys())}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/api/settings/global/reset")
def reset_global_settings(payload: SettingsResetPayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Remove overrides globais (todos, ou apenas as chaves informadas)."""
    try:
        if payload.keys:
            for key in payload.keys:
                SettingsRepository.delete_global(conn, key)
        else:
            SettingsRepository.delete_all_global(conn)
        conn.commit()
        SettingsService.invalidate()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/api/settings/project/{project_id}/reset")
def reset_project_settings(project_id: int, payload: SettingsResetPayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Remove overrides do projeto (todos, ou apenas as chaves informadas)."""
    try:
        if payload.keys:
            for key in payload.keys:
                SettingsRepository.delete_project(conn, project_id, key)
        else:
            SettingsRepository.delete_all_project(conn, project_id)
        conn.commit()
        SettingsService.invalidate(project_id)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Presets ──────────────────────────────────────────────────────────────────

@router.post("/api/settings/preset")
def apply_preset(payload: PresetApplyPayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Aplica um preset no escopo pedido.

    Aplicar um preset grava os valores dele e REMOVE os overrides das demais
    chaves cobertas pelos presets — assim 'equilibrado' (values vazio) equivale
    a voltar aos defaults do código nessas chaves.
    """
    preset = PRESETS.get(payload.preset_id)
    if preset is None:
        raise HTTPException(422, f"Preset desconhecido: '{payload.preset_id}'")
    if payload.scope == "project" and not payload.project_id:
        raise HTTPException(422, "project_id é obrigatório para scope=project")

    covered = set()
    for p in PRESETS.values():
        covered.update(p["values"].keys())

    try:
        for key in covered:
            if key in preset["values"]:
                value = preset["values"][key]
                if payload.scope == "project":
                    SettingsRepository.upsert_project(conn, payload.project_id, key, value)
                else:
                    SettingsRepository.upsert_global(conn, key, value)
            else:
                if payload.scope == "project":
                    SettingsRepository.delete_project(conn, payload.project_id, key)
                else:
                    SettingsRepository.delete_global(conn, key)
        conn.commit()
        SettingsService.invalidate(payload.project_id if payload.scope == "project" else None)
        return {"status": "success", "applied": payload.preset_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Prompts ──────────────────────────────────────────────────────────────────

@router.get("/api/settings/prompts")
def get_prompts(project_id: Optional[int] = Query(None), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Lista todos os prompts do sistema com os valores resolvidos e suas origens."""
    from src.nlp.prompt_registry import PROMPT_REGISTRY
    import json

    # Carrega overrides globais
    cursor = conn.cursor()
    cursor.execute("SELECT key, value_json FROM app_setting WHERE key LIKE 'prompt.%'")
    global_overs = {row["key"][len("prompt."):]: json.loads(row["value_json"]) for row in cursor.fetchall()}

    # Carrega overrides do projeto
    project_overs = {}
    if project_id:
        cursor.execute("SELECT key, value_json FROM project_setting WHERE project_id = ? AND key LIKE 'prompt.%'", (project_id,))
        project_overs = {row["key"][len("prompt."):]: json.loads(row["value_json"]) for row in cursor.fetchall()}

    prompts_list = []
    for pid, entry in PROMPT_REGISTRY.items():
        has_project = pid in project_overs
        has_global = pid in global_overs

        if has_project:
            value, origin = project_overs[pid], "project"
        elif has_global:
            value, origin = global_overs[pid], "global"
        else:
            value, origin = entry["default"], "default"

        prompts_list.append({
            "id": pid,
            "label": entry["label"],
            "category": entry["category"],
            "variables": entry["variables"],
            "default": entry["default"],
            "value": value,
            "origin": origin,
            "is_modified": origin != "default"
        })

    return {"status": "success", "prompts": prompts_list}


@router.put("/api/settings/prompts/{prompt_id}")
def update_prompt(
    prompt_id: str,
    payload: PromptUpdatePayload,
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """Grava ou atualiza um override de prompt (global ou por projeto)."""
    from src.nlp.prompt_registry import PROMPT_REGISTRY, validate_template, invalidate_prompt_cache
    if prompt_id not in PROMPT_REGISTRY:
        raise HTTPException(404, f"Prompt '{prompt_id}' desconhecido")

    # Valida placeholders obrigatórios
    ok, err = validate_template(prompt_id, payload.template)
    if not ok:
        raise HTTPException(422, err)

    key = f"prompt.{prompt_id}"
    try:
        if payload.scope == "project":
            if not payload.project_id:
                raise HTTPException(422, "project_id é obrigatório para escopo de projeto")
            SettingsRepository.upsert_project(conn, payload.project_id, key, payload.template)
        else:
            SettingsRepository.upsert_global(conn, key, payload.template)
        conn.commit()
        invalidate_prompt_cache(payload.project_id if payload.scope == "project" else None)
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.delete("/api/settings/prompts/{prompt_id}")
def delete_prompt_override(
    prompt_id: str,
    scope: str = Query("global"),
    project_id: Optional[int] = Query(None),
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """Remove o override de um prompt, restaurando o padrão de fábrica."""
    from src.nlp.prompt_registry import PROMPT_REGISTRY, invalidate_prompt_cache
    if prompt_id not in PROMPT_REGISTRY:
        raise HTTPException(404, f"Prompt '{prompt_id}' desconhecido")

    key = f"prompt.{prompt_id}"
    try:
        if scope == "project":
            if not project_id:
                raise HTTPException(422, "project_id é obrigatório para escopo de projeto")
            SettingsRepository.delete_project(conn, project_id, key)
        else:
            SettingsRepository.delete_global(conn, key)
        conn.commit()
        invalidate_prompt_cache(project_id if scope == "project" else None)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(500, str(e))
