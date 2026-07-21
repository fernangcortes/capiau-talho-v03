"""Extracao estruturada de roteiro: chunking, fusao e orquestracao (P2.1b/P2.1c/P2.3).

Parte PURA (sem chamada de LLM, testavel sem mock de rede):
- build_chunks: particiona as ancoras de detect_structure() em chunks de ~N chars,
  cada um com a cena anterior como [CONTEXTO] para o LLM manter continuidade.
- split_chunk: divide um chunk que falhou em duas metades. Existe porque RETRY NAO
  CONSERTA TRUNCAMENTO DETERMINISTICO -- se a saida JSON de um chunk denso estoura
  max_tokens, repetir a mesma chamada produz o mesmo truncamento. Dividir o chunk
  reduz o texto de entrada e a saida esperada, o que de fato muda o resultado.
- merge_chunk_results: funde os JSONs de todos os chunks numa estrutura unica.

Parte de EXECUCAO (chama LLM de verdade, le/grava banco, publica progresso):
- run_script_extraction: orquestra as funcoes acima, chunk por chunk, com cache por
  content_hash (P2.3) e persistencia so no sucesso completo da rodada.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

EXTRACTION_TASK_PREFIX = "extracao-roteiro-"


def extraction_task_key(doc_id: int) -> str:
    """Chave usada no TASK_MANAGER para esta rodada — a mesma chave serve de trava
    contra disparo duplo (o endpoint confere o status antes de aceitar um novo POST)."""
    return f"{EXTRACTION_TASK_PREFIX}{doc_id}"

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


# ── Execucao ──────────────────────────────────────────────────────────────────

def _run_chunk(chunk: "ScriptChunk", project_id: Optional[int], max_tokens: int,
               temperature: float, timeout: int, retries: int) -> Tuple[Optional[Dict[str, Any]], Dict[str, int]]:
    from src.nlp.llm_text import call_text_llm
    from src.nlp.prompt_registry import get_prompt

    prompt = get_prompt(
        "script_extract", project_id=project_id,
        scene_block=chunk.text, target_numbers=", ".join(str(n) for n in chunk.target_numbers),
    )
    return call_text_llm(
        prompt, project_id=project_id, log_prefix="ScriptExtract",
        max_tokens=max_tokens, temperature=temperature, timeout=timeout, retries=retries,
    )


def run_script_extraction(project_id: int, doc_id: int, force: bool = False) -> None:
    """Extrai a estrutura de um roteiro: detecta o formato, faz chunking por cena,
    chama o LLM por chunk (com split de emergência em falha de truncamento) e
    persiste cenas + entidades sugeridas. Publica progresso no TASK_MANAGER (chave
    extraction_task_key(doc_id)) para a aba Tarefas acompanhar.

    Cache por content_hash (P2.3): uma rodada 'done' para a mesma versão exata do
    texto é reaproveitada sem gastar API, a menos que force=True.

    Falha de qualquer chunk (após retries + split) aborta a rodada inteira: nada é
    persistido parcialmente -- mesma regra de segurança do P1 (upload de doc), para
    nunca deixar o catálogo de cenas pela metade.
    """
    from src.core.tasks import TASK_MANAGER
    from src.db.connection import get_db
    from src.db.repositories.entities import EntityRepository
    from src.db.repositories.projects import ProjectRepository
    from src.db.repositories.scenes import SceneRepository
    from src.nlp.llm_text import used_model
    from src.services.script_format import detect_structure_for_project
    from src.services.settings_service import SettingsService

    task_key = extraction_task_key(doc_id)

    with get_db() as conn:
        doc = ProjectRepository.get_document(conn, doc_id)
    if not doc:
        print(f"[ScriptExtract] Documento {doc_id} nao encontrado; abortando extracao.")
        TASK_MANAGER.update_progress(task_key, 0.0, "failed", task_type="script_extract",
                                     label="Documento nao encontrado")
        return

    content = doc["content"] or ""
    content_hash = doc["content_hash"]
    if not content_hash:
        content_hash = ProjectRepository.hash_doc_content(content)
        with get_db() as conn:
            conn.execute("UPDATE production_doc SET content_hash = ? WHERE id = ?", (content_hash, doc_id))
            conn.commit()

    if not force:
        with get_db() as conn:
            cached = SceneRepository.find_extraction(conn, doc_id, content_hash)
        if cached:
            print(f"[ScriptExtract] Doc {doc_id}: rodada ja concluida para esta versao "
                  f"(content_hash igual); usando cache, 0 chamadas.")
            TASK_MANAGER.update_progress(task_key, 100.0, "finished", task_type="script_extract",
                                         label="Estrutura ja extraida (cache)")
            return

    S = SettingsService.get_settings(project_id)
    chunk_chars = S.get("script_extract.chunk_chars")
    max_tokens = S.get("script_extract.max_tokens")
    temperature = S.get("script_extract.temperature")
    timeout = S.get("script_extract.timeout")
    max_retries = S.get("script_extract.max_retries")
    model_name = used_model(project_id)

    report = detect_structure_for_project(content, doc["filename"], project_id)
    print(f"[ScriptExtract] Doc {doc_id}: estrategia={report.strategy}, "
          f"{report.scene_count} cenas detectadas.")

    with get_db() as conn:
        extraction_id = SceneRepository.create_extraction(conn, project_id, doc_id, content_hash, report.strategy)
        conn.commit()

    if report.strategy == "prose":
        # Documento sem estrutura de cena (tratamento, escaleta). DECISAO DE ESCOPO:
        # nenhum documento real do projeto cai neste caminho hoje (o unico roteiro
        # cadastrado detecta como 'sluglines'), e o prompt script_extract e desenhado
        # em torno de numeros de cena -- reaproveita-lo as cegas para prosa produziria
        # uma instrucao "extraia as cenas de numero: " vazia e sem sentido para o
        # modelo. Em vez de arriscar uma extracao de baixa qualidade e nunca
        # validada, a rodada fecha como 'done' sem chamar o prompt script_extract.
        # Uma extracao de entidades dedicada a prosa (prompt e chunking proprios)
        # fica para quando houver um documento real desse tipo para calibrar contra.
        #
        # NOTA DE CUSTO: detect_structure_for_project() (acima) ja pode ter gasto 1
        # chamada barata tentando identificar um padrao de cena antes de concluir
        # 'prose' (camada 3, controlada por script.llm_format_detection) -- essa
        # chamada e da DETECCAO DE FORMATO, nao desta extracao; contabilizada por
        # detect_structure, nao por script_extraction.calls.
        print(f"[ScriptExtract] Doc {doc_id}: documento em prosa (sem estrutura de cena "
              f"reconhecida) -- nenhuma cena ou entidade extraida nesta rodada.")
        with get_db() as conn:
            SceneRepository.finish_extraction(
                conn, extraction_id, "done", strategy="prose", model=model_name, chunks=0, calls=0,
            )
            conn.commit()
        TASK_MANAGER.update_progress(task_key, 100.0, "finished", task_type="script_extract",
                                     label="Documento sem estrutura de cena (prosa)")
        return

    chunks = build_chunks(content, report.anchors, chunk_chars)
    total = len(chunks)
    TASK_MANAGER.update_progress(task_key, 0.0, "running", task_type="script_extract",
                                 label=f"Extraindo roteiro — 0 de {total} partes")

    results: List[Tuple[ScriptChunk, Optional[Dict[str, Any]]]] = []
    calls = 0
    usage_total = {"prompt_tokens": 0, "completion_tokens": 0}
    failed_chunk: Optional[ScriptChunk] = None

    for idx, chunk in enumerate(chunks, start=1):
        data, usage = _run_chunk(chunk, project_id, max_tokens, temperature, timeout, max_retries)
        calls += 1
        usage_total["prompt_tokens"] += usage.get("prompt_tokens", 0)
        usage_total["completion_tokens"] += usage.get("completion_tokens", 0)

        if data is None and chunk.target_count >= 2:
            print(f"[ScriptExtract] Doc {doc_id}: chunk {idx}/{total} falhou apos retries; "
                  f"dividindo em duas metades (truncamento nao se resolve repetindo).")
            halves = split_chunk(content, report.anchors, chunk)
            halves_ok = True
            for half in halves:
                half_data, half_usage = _run_chunk(half, project_id, max_tokens, temperature, timeout, retries=1)
                calls += 1
                usage_total["prompt_tokens"] += half_usage.get("prompt_tokens", 0)
                usage_total["completion_tokens"] += half_usage.get("completion_tokens", 0)
                if half_data is None:
                    halves_ok = False
                    break
                results.append((half, half_data))
            if not halves_ok:
                failed_chunk = chunk
                break
        elif data is None:
            failed_chunk = chunk
            break
        else:
            results.append((chunk, data))

        pct = (idx / total) * 100.0
        TASK_MANAGER.update_progress(task_key, pct, "running", task_type="script_extract",
                                     label=f"Extraindo roteiro — parte {idx} de {total}")

    if failed_chunk is not None:
        error_msg = f"Falha na extracao das cenas {failed_chunk.target_numbers} apos retries e split."
        print(f"[ScriptExtract] Doc {doc_id}: {error_msg}")
        with get_db() as conn:
            SceneRepository.finish_extraction(
                conn, extraction_id, "error", strategy=report.strategy, model=model_name,
                chunks=total, calls=calls,
                prompt_tokens=usage_total["prompt_tokens"], completion_tokens=usage_total["completion_tokens"],
                error=error_msg,
            )
            conn.commit()
        TASK_MANAGER.update_progress(task_key, 100.0, "failed", task_type="script_extract",
                                     label="Falha na extracao do roteiro")
        return

    merged = merge_chunk_results(results, report.anchors)

    with get_db() as conn:
        SceneRepository.replace_scenes_for_doc(conn, project_id, doc_id, merged["scenes"])
        for person in merged["characters"]:
            EntityRepository.upsert_suggested_entity(conn, project_id, person["name"], "person", person["description"])
        locations = sorted({s["location"] for s in merged["scenes"] if s.get("location")})
        for loc in locations:
            EntityRepository.upsert_suggested_entity(conn, project_id, loc, "location", "")
        for obj in merged["key_objects"]:
            EntityRepository.upsert_suggested_entity(conn, project_id, obj["name"], "object", obj["description"])
        SceneRepository.finish_extraction(
            conn, extraction_id, "done", strategy=report.strategy, model=model_name,
            chunks=total, calls=calls,
            prompt_tokens=usage_total["prompt_tokens"], completion_tokens=usage_total["completion_tokens"],
        )
        conn.commit()

    print(f"[ScriptExtract] Doc {doc_id}: estrategia={report.strategy}, {calls} chamadas, "
          f"{usage_total['prompt_tokens']} tokens de entrada, {usage_total['completion_tokens']} de saida, "
          f"modelo {model_name}. {len(merged['scenes'])} cenas, {len(merged['characters'])} personagens, "
          f"{len(locations)} locacoes, {len(merged['key_objects'])} objetos-chave.")

    TASK_MANAGER.update_progress(task_key, 100.0, "finished", task_type="script_extract",
                                 label=f"Roteiro extraido — {len(merged['scenes'])} cenas")
