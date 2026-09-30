"""Serviço de resolução das configurações da IA em camadas (default -> global -> projeto).

Uso pelos serviços de IA (uma resolução por tarefa, nunca por parâmetro):

    S = SettingsService.get_settings(project_id)
    temperature = S.get("timeline.temperature")
    api_key = S.api_key("openrouter")

Cache em RAM protegido por lock (o pipeline roda em threads do TASK_MANAGER) e
invalidado a cada escrita. O uvicorn roda com worker único, então a invalidação
em processo cobre todas as escritas.
"""
import threading
from typing import Any, Dict, Optional

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.settings import SettingsRepository
from src.services.settings_registry import (
    SETTINGS_REGISTRY,
    get_registry_map,
    mask_secret,
    PRESETS,
    preset_covered_keys,
)


class ResolvedSettings:
    """Snapshot imutável das configurações resolvidas para um projeto (ou só globais)."""

    def __init__(self, values: Dict[str, Any]):
        self._values = values

    def get(self, key: str) -> Any:
        if key not in self._values:
            raise KeyError(f"Configuração desconhecida: '{key}' (não está no SETTINGS_REGISTRY)")
        return self._values[key]

    def api_key(self, provider: str) -> str:
        """Chave de API resolvida: valor do banco se não-vazio, senão fallback de CONFIG/.env."""
        import os
        provider_key_map = {
            "gemini": "api.gemini_key",
            "anthropic": "api.anthropic_key",
            "deepseek": "api.deepseek_key",
            "assemblyai": "api.assemblyai_key",
            "typesafe": "api.typesafe_key",
            "nvidia_nim": "api.nvidia_nim_key",
            "openrouter": "api.openrouter_key",
            "auphonic": "api.auphonic_key",
            "deepgram": "api.deepgram_key",
        }
        env_fallback_map = {
            "gemini": "GEMINI_API_KEY",
            "anthropic": "ANTHROPIC_API_KEY",
            "deepseek": "DEEPSEEK_API_KEY",
            "assemblyai": "ASSEMBLYAI_API_KEY",
            "typesafe": "TYPESAFE_API_KEY",
            "nvidia_nim": "NVIDIA_NIM_KEY",
            "openrouter": "OPENROUTER_API_KEY",
            "auphonic": "AUPHONIC_API_KEY",
            "deepgram": "DEEPGRAM_API_KEY",
        }

        prov = provider.lower().strip()
        key_name = provider_key_map.get(prov)
        if not key_name:
            raise KeyError(f"Provedor de API desconhecido: '{provider}'")

        val = self._values.get(key_name)
        if val:
            return str(val).strip()

        # Fallback para atributo correspondente em CONFIG
        config_attr = f"{prov.upper()}_API_KEY"
        if hasattr(CONFIG, config_attr) and getattr(CONFIG, config_attr):
            return str(getattr(CONFIG, config_attr)).strip()

        # Fallback para variável de ambiente correspondente
        env_var = env_fallback_map.get(prov, "")
        if env_var and os.getenv(env_var):
            return os.environ[env_var].strip()

        return ""


class SettingsService:
    _lock = threading.Lock()
    _global_cache: Optional[Dict[str, Any]] = None
    _project_cache: Dict[int, Dict[str, Any]] = {}

    # ── Leitura ──────────────────────────────────────────────────────────────

    @staticmethod
    def _load_global() -> Dict[str, Any]:
        with SettingsService._lock:
            if SettingsService._global_cache is not None:
                return SettingsService._global_cache
        with get_db() as conn:
            data = SettingsRepository.get_all_global(conn)
        with SettingsService._lock:
            SettingsService._global_cache = data
        return data

    @staticmethod
    def _load_project(project_id: int) -> Dict[str, Any]:
        with SettingsService._lock:
            if project_id in SettingsService._project_cache:
                return SettingsService._project_cache[project_id]
        with get_db() as conn:
            data = SettingsRepository.get_all_project(conn, project_id)
        with SettingsService._lock:
            SettingsService._project_cache[project_id] = data
        return data

    @staticmethod
    def get_settings(project_id: Optional[int] = None) -> ResolvedSettings:
        """Resolve todas as configurações: default do código -> global -> projeto."""
        registry = get_registry_map()
        global_over = SettingsService._load_global()
        project_over = SettingsService._load_project(project_id) if project_id else {}

        values: Dict[str, Any] = {}
        for key, entry in registry.items():
            if key in project_over and entry.get("scope") != "global":
                values[key] = project_over[key]
            elif key in global_over:
                values[key] = global_over[key]
            else:
                values[key] = entry["default"]
        return ResolvedSettings(values)

    @staticmethod
    def get_resolved_with_origin(project_id: Optional[int] = None) -> Dict[str, Dict[str, Any]]:
        """Valores resolvidos com a origem de cada um (para o painel). Secrets já mascarados."""
        registry = get_registry_map()
        global_over = SettingsService._load_global()
        project_over = SettingsService._load_project(project_id) if project_id else {}

        result: Dict[str, Dict[str, Any]] = {}
        for key, entry in registry.items():
            is_secret = entry["type"] == "secret"
            has_project = key in project_over and entry.get("scope") != "global"
            has_global = key in global_over

            if has_project:
                value, origin = project_over[key], "project"
            elif has_global:
                value, origin = global_over[key], "global"
            else:
                value, origin = entry["default"], "default"

            if is_secret:
                value = mask_secret(value)

            result[key] = {
                "value": value,
                "origin": origin,
                "has_global_override": has_global,
                "has_project_override": has_project,
            }
        return result

    @staticmethod
    def detect_active_preset(project_id: Optional[int] = None) -> str:
        """Compara os valores resolvidos com cada preset; retorna o id do preset ou 'custom'.

        Só as chaves cobertas pela união dos presets entram na comparação — o
        'equilibrado' cobre implicitamente essas chaves com os defaults do código.
        """
        resolved = SettingsService.get_settings(project_id)
        registry = get_registry_map()
        covered = preset_covered_keys()

        for preset_id, preset in PRESETS.items():
            match = True
            for key in covered:
                expected = preset["values"].get(key, registry[key]["default"])
                if resolved.get(key) != expected:
                    match = False
                    break
            if match:
                return preset_id
        return "custom"

    # ── Invalidação ──────────────────────────────────────────────────────────

    @staticmethod
    def invalidate(project_id: Optional[int] = None) -> None:
        """Limpa o cache após escrita. Sem project_id, limpa tudo (escrita global)."""
        with SettingsService._lock:
            if project_id is None:
                SettingsService._global_cache = None
                SettingsService._project_cache.clear()
            else:
                SettingsService._project_cache.pop(project_id, None)
