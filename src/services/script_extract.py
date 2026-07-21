"""Chunking e fusao da extracao estruturada de roteiro (P2.1b).

Parte PURA deste modulo (sem chamada de LLM, testavel sem mock de rede):
- build_chunks: particiona as ancoras de detect_structure() em chunks de ~N chars,
  cada um com a cena anterior como [CONTEXTO] para o LLM manter continuidade.
- split_chunk: divide um chunk que falhou em duas metades. Existe porque RETRY NAO
  CONSERTA TRUNCAMENTO DETERMINISTICO -- se a saida JSON de um chunk denso estoura
  max_tokens, repetir a mesma chamada produz o mesmo truncamento. Dividir o chunk
  reduz o texto de entrada e a saida esperada, o que de fato muda o resultado.
- merge_chunk_results: funde os JSONs de todos os chunks numa estrutura unica.

A execucao (chamadas de LLM de verdade, cache, persistencia) fica em outro modulo,
que orquestra estas funcoes chamando src/nlp/llm_text.py por chunk.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

CONTEXT_MARKER = "[CONTEXTO]"


@dataclass
class ScriptChunk:
    """Um pedaco do roteiro pronto para virar prompt: cena(s)-alvo + 1 cena de contexto."""
    index: int
    text: str
    target_numbers: List[int] = field(default_factory=list)
    context_number: Optional[int] = None

    @property
    def target_count(self) -> int:
        return len(self.target_numbers)


def _render_chunk(
    content: str, anchors_by_number: Dict[int, Dict[str, Any]],
    target_numbers: List[int], context_number: Optional[int], index: int
) -> ScriptChunk:
    """Monta o texto de um chunk: marcador de contexto (se houver) + marcadores de alvo."""
    parts: List[str] = []

    if context_number is not None and context_number in anchors_by_number:
        ctx = anchors_by_number[context_number]
        ctx_text = content[ctx["start"]:ctx["end"]].strip()
        parts.append(f"=== CENA {ctx['number']} {CONTEXT_MARKER} ===\n{ctx_text}")

    for num in target_numbers:
        a = anchors_by_number[num]
        scene_text = content[a["start"]:a["end"]].strip()
        parts.append(f"=== CENA {a['number']} ===\n{scene_text}")

    return ScriptChunk(
        index=index, text="\n\n".join(parts),
        target_numbers=list(target_numbers), context_number=context_number,
    )


def build_chunks(content: str, anchors: List[Dict[str, Any]], chunk_chars: int = 24000) -> List[ScriptChunk]:
    """Particiona as cenas em chunks de ~chunk_chars, sem nunca cortar uma cena ao meio.

    A fronteira e sempre um limite de cena: um chunk cresce enquanto a proxima cena
    couber no orcamento; se a PRIMEIRA cena do chunk ja for maior que o orcamento
    inteiro, ela entra sozinha mesmo assim (nenhuma cena fica de fora, e o indice
    sempre avanca — sem isso um documento com uma cena gigante travaria em loop).

    A ultima cena de cada chunk vira o marcador [CONTEXTO] do chunk seguinte: o LLM
    entende a continuidade sem re-extrair a mesma cena duas vezes.
    """
    if not anchors:
        return []

    anchors_by_number = {a["number"]: a for a in anchors}
    n = len(anchors)
    chunks: List[ScriptChunk] = []
    i = 0
    prev_last_number: Optional[int] = None

    while i < n:
        budget = chunk_chars
        j = i
        while j < n:
            scene_len = anchors[j]["end"] - anchors[j]["start"]
            if j > i and scene_len > budget:
                break
            budget -= scene_len
            j += 1

        target_numbers = [a["number"] for a in anchors[i:j]]
        chunks.append(_render_chunk(content, anchors_by_number, target_numbers, prev_last_number, len(chunks)))

        prev_last_number = target_numbers[-1]
        i = j

    return chunks


def split_chunk(content: str, anchors: List[Dict[str, Any]], chunk: ScriptChunk) -> List[ScriptChunk]:
    """Divide um chunk que falhou em duas metades, na fronteira de cena do meio.

    So faz sentido chamar isto quando o chunk tem 2+ cenas-alvo: um chunk de 1 cena
    que falha e um erro de verdade (a cena e grande demais ou o modelo travou), nao
    um problema de tamanho de saida que dividir resolveria. Retorna [chunk] inalterado
    nesse caso, para o chamador decidir que nao ha mais o que tentar.
    """
    if chunk.target_count < 2:
        return [chunk]

    anchors_by_number = {a["number"]: a for a in anchors}
    mid = chunk.target_count // 2
    first_targets = chunk.target_numbers[:mid]
    second_targets = chunk.target_numbers[mid:]

    first = _render_chunk(content, anchors_by_number, first_targets, chunk.context_number, chunk.index)
    # A segunda metade usa a ultima cena da primeira como contexto -- mesma regra
    # de continuidade do build_chunks, so que dentro do proprio chunk dividido.
    second = _render_chunk(content, anchors_by_number, second_targets, first_targets[-1], chunk.index)

    return [first, second]


def merge_chunk_results(
    chunk_results: List[Tuple[ScriptChunk, Optional[Dict[str, Any]]]],
    anchors: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Funde os JSONs devolvidos por cada chunk numa unica estrutura.

    Fusao por 'numero': o particionamento de build_chunks/split_chunk garante que cada
    numero real e ALVO de exatamente um chunk, entao colisao so acontece se o modelo
    desobedecer a instrucao e extrair a cena marcada [CONTEXTO] mesmo assim. Regra
    defensiva: a versao vinda do chunk onde o numero era ALVO sempre vence, mesmo que
    chegue depois de uma versao "vazada" do contexto de outro chunk.

    `chunk_results` e uma lista de (chunk, json_ou_None) na ordem em que rodaram — os
    None (chunk sem sucesso) sao ignorados aqui porque a orquestracao ja aborta a
    rodada inteira antes de chamar merge quando algum chunk falha em definitivo.
    """
    valid_numbers = {a["number"] for a in anchors}
    scenes_by_number: Dict[int, Dict[str, Any]] = {}
    owner_was_target: Dict[int, bool] = {}
    characters: Dict[str, Dict[str, str]] = {}
    key_objects: Dict[str, Dict[str, str]] = {}

    def _merge_named_list(raw_list: Any, bucket: Dict[str, Dict[str, str]]) -> None:
        if not isinstance(raw_list, list):
            return
        for item in raw_list:
            if not isinstance(item, dict):
                continue
            name = (item.get("nome") or "").strip()
            if not name:
                continue
            key = name.lower()
            desc = (item.get("descricao") or "").strip()
            if key not in bucket or (desc and not bucket[key]["description"]):
                bucket[key] = {"name": name, "description": desc}

    for chunk, data in chunk_results:
        if not data:
            continue

        target_set = set(chunk.target_numbers)
        cenas = data.get("cenas")
        if not isinstance(cenas, list):
            cenas = []

        for c in cenas:
            if not isinstance(c, dict):
                continue
            try:
                num = int(c.get("numero"))
            except (TypeError, ValueError):
                print(f"[ScriptExtract] Cena sem numero valido descartada: {c.get('numero')!r}")
                continue
            if num not in valid_numbers:
                print(f"[ScriptExtract] Cena numero {num} fora das ancoras do documento, descartada.")
                continue

            is_target = num in target_set
            if num in scenes_by_number and owner_was_target.get(num, False):
                continue  # ja temos a versao autoritativa (do chunk-alvo); nunca sobrescreve
            if num in scenes_by_number and not is_target:
                continue  # nenhuma das duas e autoritativa ainda; mantem a primeira

            characters_list = c.get("personagens")
            props_list = c.get("props")
            scenes_by_number[num] = {
                "number": num,
                "heading": (c.get("heading") or "").strip() or None,
                "synopsis": (c.get("sinopse") or "").strip() or None,
                "characters": [n.strip() for n in characters_list if isinstance(n, str) and n.strip()] if isinstance(characters_list, list) else [],
                "props": [p.strip() for p in props_list if isinstance(p, str) and p.strip()] if isinstance(props_list, list) else [],
                "location": (c.get("locacao") or "").strip() or None,
            }
            owner_was_target[num] = is_target

        _merge_named_list(data.get("personagens"), characters)
        _merge_named_list(data.get("objetos_chave"), key_objects)

    scenes = [scenes_by_number[num] for num in sorted(scenes_by_number.keys())]
    return {
        "scenes": scenes,
        "characters": list(characters.values()),
        "key_objects": list(key_objects.values()),
    }
