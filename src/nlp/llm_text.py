"""Helper generico para chamadas de LLM de TEXTO que devolvem JSON (P2).

Molde estrutural: rewrite_description_llm() de enrichment_engine.py (retry no modelo
principal + fallback automatico para o reserva, licao medida em 17/07: falha de parsing
costuma ser transitoria, entao a defesa e repetir, nao so aumentar max_tokens).

O que este helper acrescenta e devolver tambem o `usage` da resposta
(prompt_tokens/completion_tokens), que a OpenRouter ja manda e o resto do projeto
descarta. Sem isso nao da para cumprir a convencao de "custo visivel" com numero real
em vez de estimativa.

O enrichment_engine NAO foi refatorado para usar este helper nesta entrega (seria
risco de regressao fora de escopo); fica anotado como limpeza futura.
"""
import requests
from typing import Any, Dict, Optional, Tuple

from src.nlp.json_parser import extract_json_from_markdown

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def call_text_llm(
    prompt: str,
    project_id: Optional[int] = None,
    log_prefix: str = "LLMText",
    max_tokens: int = 4000,
    temperature: float = 0.1,
    timeout: int = 120,
    retries: int = 2,
) -> Tuple[Optional[Dict[str, Any]], Dict[str, int]]:
    """Chama o modelo de texto e devolve (json_parseado | None, usage acumulado).

    O usage e acumulado por TODAS as tentativas, inclusive as que falharam: uma chamada
    que estourou o teto de tokens custou dinheiro do mesmo jeito e precisa aparecer no
    total. `None` no primeiro elemento significa que principal e reserva falharam.
    """
    from src.services.settings_service import SettingsService

    usage_total = {"prompt_tokens": 0, "completion_tokens": 0}

    S = SettingsService.get_settings(project_id)
    api_key = S.api_key("openrouter")
    if not api_key or api_key == "your_openrouter_api_key_here":
        print(f"[{log_prefix}] Chave da OpenRouter nao configurada.")
        return None, usage_total
    if not prompt or not prompt.strip():
        return None, usage_total

    primary = S.get("llm.text_model")
    fallback = S.get("llm.text_model_fallback")
    retries = max(1, retries)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    base_payload = {
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    def _attempt(model: str) -> Optional[Dict[str, Any]]:
        try:
            response = requests.post(
                OPENROUTER_URL, headers=headers,
                json={**base_payload, "model": model}, timeout=timeout
            )
            if response.status_code != 200:
                print(f"[{log_prefix}] Falha LLM (modelo {model}, status {response.status_code}): {response.text[:200]}")
                return None

            res_json = response.json()

            usage = res_json.get("usage") or {}
            usage_total["prompt_tokens"] += int(usage.get("prompt_tokens") or 0)
            usage_total["completion_tokens"] += int(usage.get("completion_tokens") or 0)

            if "choices" not in res_json:
                print(f"[{log_prefix}] Resposta sem 'choices' do modelo {model}: {res_json.get('error', res_json)}")
                return None

            content = (res_json["choices"][0]["message"].get("content") or "").strip()
            if not content:
                print(f"[{log_prefix}] Resposta vazia do modelo {model}.")
                return None

            data = extract_json_from_markdown(content)
            if isinstance(data, dict) and data:
                return data
            print(f"[{log_prefix}] JSON vazio ou invalido do modelo {model}.")
            return None
        except Exception as e:
            print(f"[{log_prefix}] Erro ao chamar {model}: {e}")
            return None

    for attempt in range(1, retries + 1):
        result = _attempt(primary)
        if result is not None:
            return result, usage_total
        print(f"[{log_prefix}] Tentativa {attempt}/{retries} falhou em {primary}.")

    if fallback and fallback != primary:
        print(f"[{log_prefix}] {retries} tentativa(s) esgotada(s) em {primary}; usando reserva {fallback}.")
        result = _attempt(fallback)
        if result is not None:
            return result, usage_total

    return None, usage_total


def used_model(project_id: Optional[int] = None) -> str:
    """Modelo de texto que o helper usaria agora (para registrar na rodada de extracao)."""
    from src.services.settings_service import SettingsService
    return SettingsService.get_settings(project_id).get("llm.text_model")
