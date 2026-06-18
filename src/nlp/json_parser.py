"""Parser universal e robusto para extração de objetos JSON de respostas de LLMs."""
import json
import re
from typing import Any, Dict
from src.core.exceptions import PipelineError

def extract_json_from_markdown(text: str) -> Dict[str, Any]:
    """Extrai e decodifica um JSON estruturado envelopado ou não em marcações markdown."""
    text_clean = text.strip()
    
    # Tenta isolar o bloco cercado por triplo acento grave (```json ou ```)
    match_markdown = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text_clean)
    if match_markdown:
        json_str = match_markdown.group(1).strip()
    else:
        json_str = text_clean
        
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        # Fallback: tenta capturar o primeiro bloco válido delimitado por chaves { ... }
        match_braces = re.search(r"(\{[\s\S]*\})", json_str)
        if match_braces:
            try:
                return json.loads(match_braces.group(1).strip())
            except json.JSONDecodeError:
                pass
        
        raise PipelineError(
            f"Erro de sintaxe no JSON retornado pela IA: {str(e)}. "
            f"Trecho inicial recebido: '{text_clean[:250]}...'"
        )
