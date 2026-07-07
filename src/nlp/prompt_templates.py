"""Templates de prompt centralizados para chamadas de IA do CapIAu-Talho."""

VISION_PROMPT = """Você é um assistente especialista em cinema. Analise esta imagem de bastidores (making of) ou set de filmagem.
Responda estritamente em Português e em formato JSON com a seguinte estrutura (não inclua marcações markdown adicionais, apenas o JSON puro):
{
  "descricao": "Uma frase concisa descrevendo o que está acontecendo e quem ou o que aparece na cena (ex: Diretor orientando ator com câmera à esquerda)",
  "tags": ["tag1", "tag2", "tag3"]
}"""

def get_vision_prompt(known_entities: list = None, detected_people: list = None) -> str:
    """Gera o prompt de visão estruturado, injetando entidades conhecidas do projeto.

    known_entities: lista de dicts {name, entity_type} já catalogados no projeto.
    detected_people: nomes de pessoas reconhecidas facialmente NESTE frame específico.
    """
    context_block = ""
    if known_entities:
        people = [e["name"] for e in known_entities if e.get("entity_type") == "person"]
        objects = [e["name"] for e in known_entities if e.get("entity_type") in ("object", "location", "other")]
        if people:
            context_block += f"\nPESSOAS CONHECIDAS NESTE PROJETO: {', '.join(people[:40])}."
        if objects:
            context_block += f"\nOBJETOS/EQUIPAMENTOS/LOCAIS CONHECIDOS: {', '.join(objects[:40])}."
    if detected_people:
        context_block += f"\nRECONHECIMENTO FACIAL CONFIRMOU NESTE FRAME: {', '.join(detected_people)}. Use esses nomes na descrição em vez de termos genéricos como 'um homem' ou 'uma pessoa'."

    if context_block:
        context_block = (
            "\nCONTEXTO DO PROJETO (use os nomes exatos abaixo quando reconhecer as pessoas/objetos na imagem; "
            "NÃO invente nomes que não estejam na lista para pessoas que você não tem certeza):" + context_block + "\n"
        )

    return f"""Você é um assistente especialista em cinema. Analise esta imagem de bastidores (making of) ou set de filmagem.
{context_block}
Responda estritamente em Português e em formato JSON com a seguinte estrutura (não inclua marcações markdown adicionais, apenas o JSON puro):
{{
  "descricao": "Uma frase concisa descrevendo o que está acontecendo e quem ou o que aparece na cena, usando nomes próprios do contexto quando aplicável",
  "pessoas": ["nomes próprios ou descrições curtas das pessoas visíveis, ex: 'Fernando' ou 'homem de boné'"],
  "objetos": ["objetos/equipamentos relevantes visíveis, ex: 'câmera Blackmagic', 'rebatedor', 'tripé'"],
  "tags": ["tag1", "tag2", "tag3"]
}}"""

def get_enrichment_rewrite_prompt(original_description: str, entities: list, replacements: dict = None) -> str:
    """Gera o prompt que reescreve uma descrição de visão substituindo termos genéricos
    pelos nomes confirmados de pessoas e objetos (auditoria humana ou reconhecimento facial)."""
    entity_lines = []
    for e in entities or []:
        etype = {"person": "pessoa", "object": "objeto/equipamento", "location": "local"}.get(e.get("entity_type", "other"), "elemento")
        entity_lines.append(f"- {e['name']} ({etype})")
    entities_block = "\n".join(entity_lines) if entity_lines else "(nenhuma)"

    replacements_block = ""
    if replacements:
        lines = [f'- Substitua exatamente o trecho "{k}" por "{v}"' for k, v in replacements.items()]
        replacements_block = "\nSUBSTITUIÇÕES LITERAIS OBRIGATÓRIAS:\n" + "\n".join(lines)

    return f"""Você reescreve descrições de imagens de bastidores de filmagem inserindo os nomes REAIS confirmados.

DESCRIÇÃO ORIGINAL (gerada por IA de visão, com termos genéricos):
"{original_description}"

ENTIDADES CONFIRMADAS PRESENTES NESTA CENA (por auditoria humana ou reconhecimento facial):
{entities_block}
{replacements_block}

REGRAS:
1. Reescreva a descrição substituindo termos genéricos ("duas pessoas", "um homem", "o diretor", "uma câmera") pelos nomes confirmados quando fizer sentido semanticamente.
2. Se houver mais entidades do que termos genéricos, incorpore os nomes extras naturalmente (ex: "..., com Fulano ao fundo").
3. NÃO invente ações ou detalhes que não estejam na descrição original.
4. Mantenha a frase concisa e natural em Português.
5. Se um nome já estiver presente na descrição original, mantenha-o.

Responda estritamente em JSON puro (sem markdown):
{{"descricao": "a descrição reescrita"}}"""

# Personas de IA para sugestões de edição na timeline
TIMELINE_PERSONAS = {
    "montadora": (
        "Você é uma MONTADORA sênior de documentários. Seu foco é ritmo e concisão: "
        "identifique trechos prolixos, redundantes ou silêncios que podem ser cortados (action DELETE), "
        "e reordene ou apare depoimentos para que a narrativa flua."
    ),
    "diretora": (
        "Você é uma DIRETORA de documentários. Seu foco é estrutura narrativa: "
        "sugira inserir depoimentos complementares que faltam na história (action INSERT em trilha de falas), "
        "abrindo, desenvolvendo e concluindo os temas com coerência emocional."
    ),
    "sound_designer": (
        "Você é um SOUND DESIGNER. Seu foco é a camada sonora: sugira inserir b-rolls com som ambiente/atmosfera "
        "nos momentos de respiro e apoiar transições entre falas (action INSERT em trilha de b-roll)."
    ),
    "colorista": (
        "Você é um COLORISTA e diretor de fotografia assistente. Seu foco é cobertura visual: "
        "identifique jump cuts e trechos longos de fala sem cobertura, e sugira b-rolls visualmente relevantes "
        "para cobrir esses momentos (action INSERT em trilha de b-roll, sincronizado com o assunto falado)."
    ),
}

def get_timeline_suggestion_prompt(persona: str, timeline_context: str, candidates_context: str, user_brief: str = "") -> str:
    """Gera o prompt de sugestões de edição para a timeline com contexto real do corte atual."""
    persona_block = TIMELINE_PERSONAS.get(persona, TIMELINE_PERSONAS["diretora"])
    brief_block = f"\nPEDIDO ESPECÍFICO DO EDITOR: {user_brief}\n" if user_brief else ""

    return f"""{persona_block}

ESTADO ATUAL DA TIMELINE (corte em andamento do making of):
{timeline_context}

MATERIAL DISPONÍVEL NA BIBLIOTECA (candidatos para inserção):
{candidates_context}
{brief_block}
TAREFA: Proponha de 1 a 5 edições concretas na timeline. Para cada sugestão:
- "action": "INSERT" (inserir novo clipe), "DELETE" (remover trecho de um clipe existente) ou "REPLACE" (substituir um clipe existente).
- "video_id": ID do vídeo fonte (obrigatório para INSERT/REPLACE; use APENAS IDs listados acima).
- "source_in_s" / "source_out_s": trecho do arquivo fonte em segundos (dentro da duração do vídeo).
- "timeline_start_s": onde o clipe entra na timeline, em segundos.
- "track": id da trilha de destino (use os ids de trilha listados no estado da timeline).
- "target_clip_id": id do clipe alvo (obrigatório para DELETE/REPLACE; use os ids listados).
- "reason": justificativa editorial curta e específica (cite o conteúdo, ex: "cobre a fala sobre a escolha da lente com imagem da câmera").

Responda estritamente em JSON puro (sem markdown):
{{"suggestions": [{{"action": "INSERT", "video_id": 3, "source_in_s": 12.0, "source_out_s": 18.5, "timeline_start_s": 42.0, "track": "V2", "target_clip_id": null, "reason": "..."}}]}}"""

def get_theme_naming_prompt(clusters_block: str, existing_themes: list = None) -> str:
    """Gera o prompt para nomear clusters de conteúdo já agrupados por embeddings."""
    existing_block = ""
    if existing_themes:
        titles = "\n".join([f"- {t}" for t in existing_themes])
        existing_block = f"""
TEMAS JÁ EXISTENTES NO PROJETO (se um cluster corresponder a um destes, reutilize EXATAMENTE o mesmo título):
{titles}
"""

    return f"""Você é um editor sênior de documentários. Grupos de trechos de conteúdo (falas de entrevistas, descrições de b-roll e fotos de set) foram agrupados automaticamente por similaridade semântica.

Para CADA grupo abaixo, crie:
1. "title": um título temático claro e profissional (máx 5 palavras, ex: "Direção de Atores", "Luz e Fotografia").
2. "description": uma frase explicando o tema.
{existing_block}
GRUPOS DE CONTEÚDO:
{clusters_block}

Responda estritamente em JSON puro (sem markdown), mapeando pelo id do grupo:
{{"clusters": [{{"cluster_id": 0, "title": "...", "description": "..."}}]}}"""

def get_interview_summary_prompt(formatted_transcript: str) -> str:
    """Gera o prompt para sumarização de entrevistas de depoimentos."""
    return f"""Você é um editor sênior de documentários de cinema.
Analise a transcrição abaixo (composta por trechos falados com marcação de tempo e falante) e gere metadados editoriais úteis para a montagem.

TRANSCRIÇÃO DO VÍDEO:
{formatted_transcript}

Responda estritamente em Português e em formato JSON com a seguinte estrutura (não inclua marcações markdown adicionais de código como ```json, responda apenas o JSON puro):
{{
  "description": "Uma frase concisa resumindo quem é o entrevistado e o tema principal discutido (ex: Entrevista com o Diretor de Fotografia sobre a escolha da câmera RED e o tom sombrio)",
  "summary": "Um resumo detalhado em tópicos (bullet points) destacando as principais ideias, reflexões ou histórias contadas na entrevista, adequado para entender o conteúdo sem assistir todo o clipe",
  "tags": ["tag1", "tag2", "tag3"]
}}"""

def get_broll_summary_prompt(formatted_visuals: str) -> str:
    """Gera o prompt para sumarização de vídeos B-roll a partir de descrições de frames."""
    return f"""Você é um editor sênior de documentários de cinema.
Analise a sequência de ações visuais descritas abaixo, capturadas em frames a cada 10 segundos em um vídeo de B-roll (material de cobertura / bastidores), e gere metadados editoriais úteis.

SEQUÊNCIA DE AÇÕES VISUAIS:
{formatted_visuals}

Responda estritamente em Português e em formato JSON com a seguinte estrutura (não inclua marcações markdown adicionais de código como ```json, responda apenas o JSON puro):
{{
  "description": "Uma frase concisa descrevendo o conteúdo visual e a ação geral ocorrendo neste B-roll (ex: Bastidores da equipe preparando a iluminação e tripé da câmera no set de gravação externo)",
  "summary": "Um resumo do desenrolar da ação ou cenário apresentado neste clipe, descrevendo sua utilidade e valor editorial/estético para a edição (ex: Sequência útil para transições, mostrando a interação informal entre o diretor e atores antes do 'ação')",
  "tags": ["tag1", "tag2", "tag3"]
}}"""

def get_theme_clustering_prompt(formatted_transcript: str) -> str:
    """Gera o prompt para clusterização de temas narrativos a partir de blocos de transcrição."""
    return f"""Você é um editor sênior de documentários de cinema. 
Analise a transcrição abaixo (composta de trechos de making of e bastidores de um filme) e identifique de 5 a 8 temas/tópicos narrativos principais abordados (ex: "Direção de Atores", "Desafios de Efeitos Especiais", "Desenvolvimento de Roteiro", "Luz e Fotografia", etc.).

Para cada tema identificado:
1. Crie um título claro e profissional.
2. Escreva uma breve descrição do que se trata o tema.
3. Forneça uma lista de quais 'Bloco ID' se encaixam nesse tema.

TRANSCRIÇÃO DE ENTRADAS:
{formatted_transcript}

Responda estritamente em Português e em formato JSON puro, sem marcações markdown de blocos ou explicações extras. Use o seguinte formato:
{{
  "themes": [
    {{
      "title": "Título do Tema",
      "description": "Breve descrição do tema",
      "blocks": [1, 3, 5]
    }}
  ]
}}"""

def get_chatbot_system_prompt(context_str: str) -> str:
    """Gera o prompt de sistema para o chatbot RAG com base no contexto injetado."""
    return f"""Você é o Assistente IA do CapIAu-Talho, um co-editor e assistente de roteiro/produção de cinema inteligente.
Você ajuda o usuário a montar seu filme a partir do material de bastidores (making of), fotos de set e documentos de produção.

Ao responder às perguntas do usuário, use o contexto fornecido abaixo, que contém trechos de transcrição de depoimentos, descrições visuais de B-roll, descrições de fotos de set e documentos de produção.
IMPORTANTE: Sempre cite as mídias específicas em sua resposta quando apropriado, usando o formato de link markdown exato:
- Para vídeos (entrevistas ou b-rolls): `[Texto descritivo ou Nome do Arquivo](video_id: ID_DO_VIDEO, start: START_TIME, end: END_TIME)` (Ex: [Depoimento do Diretor](video_id: 2, start: 15.4, end: 28.0)). O player pulará para esse tempo.
- Para fotos: `[Texto descritivo](photo_id: ID_DA_FOTO)` (Ex: [Foto da equipe de luz](photo_id: 5)).
- Para documentos: `[Nome do Documento](doc_id: ID_DO_DOC)` (Ex: [Pauta de Entrevistas](doc_id: 1)).

Seja profissional, criativo, dê sugestões de montagem e de narrativa. Escreva sempre em Português.

CONTEXTO RELEVANTE DO PROJETO:
{context_str if context_str else "Nenhum material indexado ou correspondente encontrado no banco vetorial."}
"""
