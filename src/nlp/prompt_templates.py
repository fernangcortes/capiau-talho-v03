"""Templates de prompt centralizados para chamadas de IA do CapIAu-Talho.

Delegam a resolução dos templates para o PromptRegistry para suportar
prompts editáveis pelo painel de configurações.
"""
from typing import Optional
from src.nlp.prompt_registry import get_prompt, PROMPT_REGISTRY, TRIAGE_CATEGORIES, _triage_categories_block

# Rótulos amigáveis das categorias de triagem (para injetar em prompts e UI)
CATEGORY_LABELS = {
    "obra": "Obra (cena/take)",
    "processo": "Making of / Processo",
    "depoimento": "Depoimento",
    "cotidiano": "Cotidiano da equipe",
    "evento": "Evento",
    "tecnico": "Material técnico",
    "arquivo": "Arquivo / Terceiros",
    "pessoal": "Pessoal / Sem relação",
    "documento": "Documento",
}

# Mantido para retrocompatibilidade com chamadores legados
VISION_PROMPT = PROMPT_REGISTRY["vision"]["default"]
TIMELINE_PERSONAS = {
    "montadora": PROMPT_REGISTRY["persona.montadora"]["default"],
    "diretora": PROMPT_REGISTRY["persona.diretora"]["default"],
    "sound_designer": PROMPT_REGISTRY["persona.sound_designer"]["default"],
    "colorista": PROMPT_REGISTRY["persona.colorista"]["default"],
}


def _triage_feedback_block(project_id: Optional[int]) -> str:
    """Últimas correções humanas de categoria viram exemplos no prompt (few-shot, E2.C3).

    Lê a tabela triage_feedback (alimentada pelos PATCH /category do E2.C2).
    Qualquer falha aqui degrada para prompt sem exemplos — nunca derruba a triagem.
    """
    if not project_id:
        return ""
    try:
        from src.services.settings_service import SettingsService
        limit = int(SettingsService.get_settings(project_id).get("triage.feedback_examples"))
    except Exception:
        limit = 6
    if limit <= 0:
        return ""

    try:
        from src.db.connection import get_db
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """SELECT f.media_kind, f.media_id, f.wrong_category, f.right_category, f.note,
                          COALESCE(v.title, v.filename, p.title, p.filename) AS label
                   FROM triage_feedback f
                   LEFT JOIN video v ON f.media_kind = 'video' AND v.id = f.media_id
                   LEFT JOIN photo p ON f.media_kind = 'photo' AND p.id = f.media_id
                   WHERE f.project_id = ?
                   ORDER BY f.id DESC LIMIT ?""",
                (project_id, limit)
            )
            rows = cursor.fetchall()
    except Exception:
        return ""

    if not rows:
        return ""

    lines = []
    for r in rows:
        label = r["label"] or f"{r['media_kind']} {r['media_id']}"
        wrong = r["wrong_category"] or "sem categoria"
        line = f'- "{label}": a IA classificou como \'{wrong}\' e o usuário corrigiu para \'{r["right_category"]}\''
        if r["note"]:
            line += f" (motivo: {r['note']})"
        lines.append(line)
    return (
        "\nCORREÇÕES RECENTES DO USUÁRIO NESTE PROJETO (respeite estes padrões em casos parecidos; "
        "a imagem continua mandando):\n" + "\n".join(lines) + "\n"
    )


def get_triage_prompt(filename: str = "", folder_hint: str = "", transcript_snippet: str = "", known_entities: list = None, project_id: Optional[int] = None) -> str:
    """Gera o prompt de triagem (categoria Eixo A + título) com o contexto barato disponível."""
    context_lines = []
    if filename:
        context_lines.append(f"- Nome do arquivo: {filename}")
    if folder_hint:
        context_lines.append(f"- Pasta de origem: {folder_hint}")
    if transcript_snippet:
        context_lines.append(f"- Trecho da transcrição do áudio: \"{transcript_snippet[:800]}\"")
    if known_entities:
        names = ", ".join([e["name"] for e in known_entities[:30]])
        context_lines.append(f"- Pessoas/objetos/locais já catalogados no projeto: {names}")

    context_block = ""
    if context_lines:
        context_block = "\nCONTEXTO DISPONÍVEL (pistas, não verdades absolutas — a imagem manda):\n" + "\n".join(context_lines) + "\n"

    # Few-shot com correções humanas (E2.C3) — entra pelo context_block para não
    # exigir mudança em templates 'triage' customizados pelo usuário.
    context_block += _triage_feedback_block(project_id)

    return get_prompt(
        "triage",
        project_id=project_id,
        categories_block=_triage_categories_block(),
        context_block=context_block
    )


def get_vision_prompt(known_entities: list = None, detected_people: list = None, project_id: Optional[int] = None, category: Optional[str] = None) -> str:
    """Gera o prompt de visão estruturado, injetando entidades conhecidas do projeto."""
    context_block = ""
    if category and category in TRIAGE_CATEGORIES:
        label = CATEGORY_LABELS.get(category, category)
        context_block += (
            f"\nCLASSIFICAÇÃO DO ARQUIVO: este vídeo foi classificado como '{label}' "
            f"({TRIAGE_CATEGORIES[category]}). Descreva o frame dentro desse contexto, sem repetir a categoria como descrição."
        )
    if known_entities:
        objects = [e["name"] for e in known_entities if e.get("entity_type") in ("object", "location", "other")]
        if objects:
            context_block += f"\nOBJETOS/EQUIPAMENTOS/LOCAIS CONHECIDOS: {', '.join(objects[:40])}."
    
    if detected_people:
        lines = []
        for p in detected_people:
            name = p["name"]
            bbox = p["bbox"]
            if bbox:
                lines.append(f"- '{name}': rosto localizado em [x_min={bbox[0]:.4f}, y_min={bbox[1]:.4f}, largura={bbox[2]:.4f}, altura={bbox[3]:.4f}]")
            else:
                lines.append(f"- '{name}': presente na cena")
        
        context_block += "\nRECONHECIMENTO FACIAL E LOCALIZAÇÃO DE ROSTOS CONFIRMADOS NESTA IMAGEM:\n" + "\n".join(lines)
        context_block += "\nIMPORTANTE: Use os nomes próprios acima para descrever a pessoa localizada em cada coordenada correspondente. Por exemplo, se a face de 'Fernando' está localizada em x_min=0.23, e a pessoa com essa face está segurando um objeto, descreva Fernando segurando o objeto. Isso evita confundir as ações de cada pessoa na cena."

    if context_block:
        context_block = (
            "\nCONTEXTO DO PROJETO (use os nomes exatos abaixo quando reconhecer as pessoas/objetos na imagem; "
            "NÃO invente nomes que não estejam na lista para pessoas que você não tem certeza):" + context_block + "\n"
        )

    return get_prompt("vision", project_id=project_id, context_block=context_block)


def get_photo_vision_prompt(known_entities: list = None, detected_people: list = None, project_id: Optional[int] = None) -> str:
    """Prompt de visão para FOTOS: descrição + triagem (categoria/título) em uma única chamada."""
    base = get_vision_prompt(known_entities, detected_people, project_id=project_id)
    cats = ", ".join([f"'{k}'" for k in TRIAGE_CATEGORIES.keys()])
    suffix = (
        "\n\nADICIONALMENTE, inclua no MESMO objeto JSON os campos de triagem desta foto:\n"
        f'  "categoria": a chave que melhor descreve a foto, entre: {cats}\n'
        '  "confianca": número de 0.0 a 1.0\n'
        '  "titulo": "título curto de 3 a 6 palavras específico desta foto"\n'
        "Definições das categorias:\n" + _triage_categories_block()
        + _triage_feedback_block(project_id)
    )
    return base + suffix


def get_enrichment_rewrite_prompt(original_description: str, entities: list, replacements: dict = None, project_id: Optional[int] = None) -> str:
    """Gera o prompt que reescreve uma descrição de visão substituindo termos genéricos pelos nomes confirmados."""
    entity_lines = []
    for e in entities or []:
        etype = {"person": "pessoa", "object": "objeto/equipamento", "location": "local"}.get(e.get("entity_type", "other"), "elemento")
        entity_lines.append(f"- {e['name']} ({etype})")
    entities_block = "\n".join(entity_lines) if entity_lines else "(nenhuma)"

    replacements_block = ""
    if replacements:
        lines = [f'- Substitua exatamente o trecho "{k}" por "{v}"' for k, v in replacements.items()]
        replacements_block = "\nSUBSTITUIÇÕES LITERAIS OBRIGATÓRIAS:\n" + "\n".join(lines)

    return get_prompt(
        "enrichment_rewrite",
        project_id=project_id,
        original_description=original_description,
        entities_block=entities_block,
        replacements_block=replacements_block
    )


def get_timeline_suggestion_prompt(persona: str, timeline_context: str, candidates_context: str, user_brief: str = "", project_id: Optional[int] = None) -> str:
    """Gera o prompt de sugestões de edição para a timeline com contexto real do corte atual."""
    try:
        persona_block = get_prompt(f"persona.{persona}", project_id=project_id)
    except KeyError:
        persona_block = get_prompt("persona.diretora", project_id=project_id)

    brief_block = f"\nPEDIDO ESPECÍFICO DO EDITOR: {user_brief}\n" if user_brief else ""

    return get_prompt(
        "timeline_suggestion",
        project_id=project_id,
        persona_block=persona_block,
        timeline_context=timeline_context,
        candidates_context=candidates_context,
        brief_block=brief_block
    )


def get_theme_naming_prompt(clusters_block: str, existing_themes: list = None, project_id: Optional[int] = None) -> str:
    """Gera o prompt para nomear clusters de conteúdo já agrupados por embeddings."""
    existing_block = ""
    if existing_themes:
        titles = "\n".join([f"- {t}" for t in existing_themes])
        existing_block = f"\nTEMAS JÁ EXISTENTES NO PROJETO (se um cluster corresponder a um destes, reutilize EXATAMENTE o mesmo título):\n{titles}\n"

    return get_prompt(
        "theme_naming",
        project_id=project_id,
        clusters_block=clusters_block,
        existing_block=existing_block
    )


def get_interview_summary_prompt(formatted_transcript: str, project_id: Optional[int] = None) -> str:
    """Gera o prompt para sumarização de entrevistas de depoimentos."""
    return get_prompt("interview_summary", project_id=project_id, formatted_transcript=formatted_transcript)


def get_broll_summary_prompt(formatted_visuals: str, project_id: Optional[int] = None, category: Optional[str] = None) -> str:
    """Gera o prompt para sumarização de vídeos a partir de descrições de frames."""
    category_block = ""
    if category and category in TRIAGE_CATEGORIES:
        label = CATEGORY_LABELS.get(category, category)
        category_block = f"CLASSIFICAÇÃO DO ARQUIVO: '{label}' ({TRIAGE_CATEGORIES[category]}).\n"
    return get_prompt("broll_summary", project_id=project_id, formatted_visuals=formatted_visuals, category_block=category_block)


def get_theme_clustering_prompt(formatted_transcript: str, project_id: Optional[int] = None) -> str:
    """Gera o prompt para clusterização de temas narrativos a partir de blocos de transcrição."""
    return get_prompt("theme_clustering", project_id=project_id, formatted_transcript=formatted_transcript)


def get_chatbot_system_prompt(context_str: str, project_id: Optional[int] = None) -> str:
    """Gera o prompt de sistema para o chatbot RAG com base no contexto injetado."""
    return get_prompt("chatbot_system", project_id=project_id, context_str=context_str if context_str else "Nenhum material indexado ou correspondente encontrado no banco vetorial.")


def get_agent_system_prompt(timeline_context: str, context_str: str, project_id: Optional[int] = None) -> str:
    """Gera o prompt de sistema do agente de edição para guiar a agência e o function-calling."""
    return get_prompt("agent_system", project_id=project_id, timeline_context=timeline_context, context_str=context_str)
