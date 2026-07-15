"""Catálogo central de configurações da IA (fonte da verdade do Painel de Configurações).

Cada entrada descreve uma configuração: tipo, default (idêntico ao valor que era
hardcoded no código — paridade obrigatória), limites, textos de ajuda e visibilidade
(modo simples vs. profissional). O painel da UI se auto-gera a partir deste catálogo
via GET /api/settings/registry.

IMPORTANTE: os defaults abaixo NÃO são copiados para o banco. As tabelas app_setting
e project_setting guardam apenas overrides; banco vazio = comportamento idêntico ao
que existia antes do painel.
"""
from typing import Any, Dict, List, Optional, Tuple

from src.config import CONFIG

# ── Categorias exibidas na navegação do painel ───────────────────────────────

CATEGORIES = [
    {"id": "models_keys",   "label": "Modelos & Chaves",     "icon": "fa-key"},
    {"id": "transcription", "label": "Transcrição",          "icon": "fa-comment-dots"},
    {"id": "vision",        "label": "Visão & Resumos",      "icon": "fa-eye"},
    {"id": "timeline",      "label": "Timeline & Sugestões", "icon": "fa-film"},
    {"id": "agent_chat",    "label": "Agente & Chat",        "icon": "fa-robot"},
    {"id": "themes_search", "label": "Temas & Busca",        "icon": "fa-brain"},
    {"id": "faces",         "label": "Rostos",               "icon": "fa-user"},
    {"id": "prompts",       "label": "Prompts",              "icon": "fa-terminal", "pro_only": True},
]

# ── Catálogo de configurações ────────────────────────────────────────────────
# Campos: key, type (int|float|bool|string|enum|secret), default, min/max/step,
# enum (lista de opções, p/ type=enum), label, help (linguagem leiga),
# help_tech (detalhe técnico p/ modo pro), category, level (simple|pro),
# scope (both|global), requires_reprocess (True => só afeta novas análises).

SETTINGS_REGISTRY: List[Dict[str, Any]] = [
    # ── Modelos & Chaves ─────────────────────────────────────────────────────
    {
        "key": "api.openrouter_key", "type": "secret", "default": "",
        "label": "Chave OpenRouter",
        "help": "Chave de API usada por toda a IA de texto e visão (chat, resumos, sugestões). Armazenada localmente no banco do app; se vazia, usa a do arquivo .env.",
        "help_tech": "Authorization Bearer em todas as chamadas https://openrouter.ai/api/v1/chat/completions.",
        "category": "models_keys", "level": "simple", "scope": "global", "requires_reprocess": False,
    },
    {
        "key": "api.assemblyai_key", "type": "secret", "default": "",
        "label": "Chave AssemblyAI",
        "help": "Chave de API do serviço de transcrição de falas. Armazenada localmente; se vazia, usa a do arquivo .env.",
        "help_tech": "aai.settings.api_key no pipeline de transcrição.",
        "category": "models_keys", "level": "simple", "scope": "global", "requires_reprocess": False,
    },
    {
        "key": "llm.text_model", "type": "string", "default": "deepseek/deepseek-chat",
        "label": "Modelo de texto",
        "help": "Modelo de IA usado para resumos, temas, sugestões de timeline e chat. Formato OpenRouter, ex.: deepseek/deepseek-chat.",
        "help_tech": "Substitui CONFIG.TEXT_MODEL nas chamadas de rag, timeline_ai, summary, theme_engine e enrichment.",
        "category": "models_keys", "level": "simple", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "llm.vision_model", "type": "string", "default": "google/gemini-2.5-flash",
        "label": "Modelo de visão",
        "help": "Modelo de IA que descreve imagens (frames de B-roll e fotos de set).",
        "help_tech": "Substitui CONFIG.VISION_MODEL em analyze_video_vision/analyze_photo_vision.",
        "category": "models_keys", "level": "simple", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "agent.model", "type": "enum", "default": CONFIG.AGENT_MODEL,
        "enum": list(CONFIG.AGENT_MODELS),
        "label": "Modelo do Agente de Edição",
        "help": "Modelo de IA usado pelo agente que edita a timeline por comandos de chat.",
        "help_tech": "Default do payload do agente; pode ser sobreposto por requisição (agent_model).",
        "category": "models_keys", "level": "simple", "scope": "both", "requires_reprocess": False,
    },

    # ── Transcrição ──────────────────────────────────────────────────────────
    {
        "key": "asr.language", "type": "enum", "default": "pt",
        "enum": ["pt", "en", "es"],
        "label": "Idioma da transcrição",
        "help": "Idioma falado nos vídeos. Afeta apenas transcrições novas.",
        "help_tech": "language_code do aai.TranscriptionConfig.",
        "category": "transcription", "level": "simple", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "asr.speaker_labels", "type": "bool", "default": True,
        "label": "Identificar falantes (diarização)",
        "help": "Separa automaticamente quem está falando (Falante A, Falante B...). Afeta apenas transcrições novas.",
        "help_tech": "speaker_labels do aai.TranscriptionConfig.",
        "category": "transcription", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "vad.energy_floor", "type": "float", "default": 250.0, "min": 50.0, "max": 1000.0, "step": 10.0,
        "label": "VAD: piso de energia",
        "help": "Sensibilidade mínima de volume para considerar que há fala num B-roll. Valores menores detectam falas mais baixas (mais transcrições).",
        "help_tech": "energy_threshold = max(piso, média*1.5) no detect_voice_activity_offline.",
        "category": "transcription", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "vad.speech_ratio_min", "type": "float", "default": 0.04, "min": 0.0, "max": 0.5, "step": 0.01,
        "label": "VAD: proporção mínima de fala",
        "help": "Fração mínima do vídeo com fala para o B-roll ser transcrito.",
        "help_tech": "speech_ratio > X no detect_voice_activity_offline.",
        "category": "transcription", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "vad.max_energy_min", "type": "float", "default": 350.0, "min": 50.0, "max": 2000.0, "step": 10.0,
        "label": "VAD: pico mínimo de energia",
        "help": "Volume de pico mínimo para o B-roll ser considerado com fala.",
        "help_tech": "max_energy > X no detect_voice_activity_offline.",
        "category": "transcription", "level": "pro", "scope": "both", "requires_reprocess": True,
    },

    # ── Visão & Resumos ──────────────────────────────────────────────────────
    {
        "key": "vision.frame_interval", "type": "int", "default": 10, "min": 2, "max": 60, "step": 1,
        "label": "Intervalo entre frames analisados (s)",
        "help": "A cada quantos segundos a IA analisa um frame do B-roll. Menor = mais detalhe e mais custo. Afeta apenas análises novas.",
        "help_tech": "Substitui CONFIG.FRAME_INTERVAL na extração de frames para visão.",
        "category": "vision", "level": "simple", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "vision.use_segments", "type": "bool", "default": True,
        "label": "Visão: usar segmentação real (shots/beats)",
        "help": "Analisa 1 frame por trecho detectado (corte ou mudança visual) em vez do relógio fixo. Menos chamadas de API e janelas de busca precisas.",
        "help_tech": "analyze_video_vision usa segment_video() sobre o proxy; frame_interval vira só o teto de frames.",
        "category": "vision", "level": "simple", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "segment.detect_threshold", "type": "float", "default": 27.0, "min": 5.0, "max": 60.0, "step": 1.0,
        "label": "Segmentação: sensibilidade a cortes",
        "help": "Menor = mais cortes detectados (mais sensível). O padrão 27 funciona para a maioria do material.",
        "help_tech": "threshold do ContentDetector do PySceneDetect.",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "segment.min_beat_shot_s", "type": "int", "default": 20, "min": 5, "max": 120, "step": 5,
        "label": "Segmentação: duração mín. p/ dividir em beats (s)",
        "help": "Planos mais longos que isso são subdivididos quando o conteúdo visual muda (câmera na mão, plano-sequência).",
        "help_tech": "min_beat_shot_s do detect_beats em segmentation.py.",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "segment.beat_embedder", "type": "enum", "default": "hsv", "enum": ["hsv", "clip"],
        "label": "Segmentação: método de deriva dos beats",
        "help": "Como medir a mudança visual dentro de planos longos. 'hsv' (cor) é rápido na CPU e é o padrão; 'clip' (IA visual) é mais preciso, porém bem mais lento. Você pode reanalisar um vídeo específico com CLIP sob demanda no inspetor.",
        "help_tech": "Escolhe o embed_fn do detect_beats: histograma HSV (local barato) ou ImageSearch.embed_frame_bgr (CLIP CPU).",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "segment.beat_drift_threshold", "type": "float", "default": 0.35, "min": 0.05, "max": 0.9, "step": 0.05,
        "label": "Segmentação: deriva visual p/ novo beat",
        "help": "Quanto o visual precisa mudar para abrir um novo trecho dentro do mesmo plano. Menor = mais beats.",
        "help_tech": "Distância cosseno ao centróide corrente (limiar calibrado para HSV; com CLIP costuma pedir valor menor).",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "segment.beat_sample_interval_s", "type": "float", "default": 1.5, "min": 0.5, "max": 5.0, "step": 0.5,
        "label": "Segmentação: intervalo de amostragem dos beats (s)",
        "help": "A cada quantos segundos um frame é amostrado para medir a deriva visual dentro de planos longos.",
        "help_tech": "sample_interval_s do detect_beats (processo local, sem custo de API).",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "segment.min_keyframe_gap_s", "type": "float", "default": 2.0, "min": 0.0, "max": 15.0, "step": 0.5,
        "label": "Segmentação: distância mínima entre keyframes (s)",
        "help": "Keyframes mais próximos que isso são fundidos, evitando frames quase idênticos de cortes rápidos. 0 = não funde nada.",
        "help_tech": "min_gap do _plan_keyframes: dedup temporal após fatiar segmentos longos por vision.frame_interval.",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "segment.motion_enabled", "type": "bool", "default": False,
        "label": "Segmentação: classificar movimento de câmera",
        "help": "Rotula cada trecho como parado, pan, tilt, caminhando, câmera na mão ou chicote. Desligado por padrão porque o fluxo óptico é lento na CPU; ligue quando quiser as facetas de movimento.",
        "help_tech": "classify_motion (fluxo óptico esparso LK) grava motion_label em media_segment.",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "analysis.effort_overrides", "type": "string", "default": "", "json_map": "effort_overrides",
        "label": "Análise: esforço por categoria (JSON)",
        "help": 'Quanto de análise cara cada tipo de material recebe. Vazio = padrão: obra/processo/depoimento/evento recebem análise completa; tecnico/arquivo/documento recebem 1 frame por plano; cotidiano/pessoal recebem só 2 frames. Para mudar, escreva um JSON como {"cotidiano": "completo", "arquivo": "triagem"}. Esforços válidos: completo | reduzido | triagem.',
        "help_tech": "Override do DEFAULT_EFFORT_BY_CATEGORY em analysis_policy.py; get_profile() controla beats, piso de cobertura e teto de keyframes em analyze_video_vision.",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "triage.min_confidence", "type": "float", "default": 0.55, "min": 0.0, "max": 1.0, "step": 0.05,
        "label": "Triagem: confiança mínima",
        "help": "Confiança mínima da IA de triagem para definir automaticamente o tipo do vídeo (entrevista/b-roll) a partir da categoria detectada.",
        "help_tech": "Limiar usado em PipelineService.triage_video para derivar video_type de 'unknown'. Com confiança >= 0.8 a triagem pode corrigir tipos definidos por nome de arquivo.",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "vision.temperature", "type": "float", "default": 0.2, "min": 0.0, "max": 2.0, "step": 0.05,
        "label": "Visão: criatividade (temperature)",
        "help": "Quanto maior, mais criativa (e menos previsível) a descrição das imagens.",
        "help_tech": "temperature do payload da chamada de visão.",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "vision.timeout", "type": "int", "default": 20, "min": 5, "max": 180, "step": 5,
        "label": "Visão: timeout (s)",
        "help": "Tempo máximo de espera por análise de cada imagem.",
        "help_tech": "timeout do requests.post da visão.",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "summary.temperature", "type": "float", "default": 0.3, "min": 0.0, "max": 2.0, "step": 0.05,
        "label": "Resumos: criatividade (temperature)",
        "help": "Criatividade da IA ao gerar descrição, sumário e tags dos vídeos.",
        "help_tech": "temperature do generate_video_summary.",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "summary.timeout", "type": "int", "default": 30, "min": 5, "max": 300, "step": 5,
        "label": "Resumos: timeout (s)",
        "help": "Tempo máximo de espera pela geração de resumo de cada vídeo.",
        "help_tech": "timeout do requests.post do summary.",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "summary.transcript_max_chars", "type": "int", "default": 25000, "min": 2000, "max": 100000, "step": 1000,
        "label": "Resumos: máx. de caracteres enviados",
        "help": "Limite de texto da transcrição enviado à IA por resumo. Maior = mais contexto e mais custo.",
        "help_tech": "Truncamento formatted[:N] no generate_video_summary.",
        "category": "vision", "level": "pro", "scope": "both", "requires_reprocess": False,
    },

    # ── Timeline & Sugestões ─────────────────────────────────────────────────
    {
        "key": "timeline.max_suggestions", "type": "int", "default": 5, "min": 1, "max": 10, "step": 1,
        "label": "Nº máximo de sugestões",
        "help": "Quantas edições a IA propõe de cada vez na pista de sugestões (ghost clips).",
        "help_tech": "Trunca validated[:N] no TimelineAIService.suggest.",
        "category": "timeline", "level": "simple", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "timeline.default_persona", "type": "enum", "default": "diretora",
        "enum": ["montadora", "diretora", "sound_designer", "colorista"],
        "label": "Persona padrão",
        "help": "Estilo de olhar da IA pré-selecionado ao pedir sugestões de timeline.",
        "help_tech": "Fallback quando a persona enviada não existe em TIMELINE_PERSONAS.",
        "category": "timeline", "level": "simple", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "timeline.temperature", "type": "float", "default": 0.4, "min": 0.0, "max": 2.0, "step": 0.05,
        "label": "Sugestões: criatividade (temperature)",
        "help": "Quanto maior, mais ousadas as sugestões de corte.",
        "help_tech": "temperature do TimelineAIService.suggest.",
        "category": "timeline", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "timeline.timeout", "type": "int", "default": 60, "min": 10, "max": 300, "step": 5,
        "label": "Sugestões: timeout (s)",
        "help": "Tempo máximo de espera pelas sugestões da IA.",
        "help_tech": "timeout do requests.post do suggest.",
        "category": "timeline", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "timeline.max_candidate_videos", "type": "int", "default": 25, "min": 5, "max": 100, "step": 5,
        "label": "Máx. de vídeos candidatos",
        "help": "Quantos vídeos da biblioteca a IA considera ao sugerir inserções. Mais = melhor cobertura e mais custo.",
        "help_tech": "MAX_CANDIDATE_VIDEOS no build_candidates_context.",
        "category": "timeline", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "timeline.max_candidate_photos", "type": "int", "default": 15, "min": 0, "max": 60, "step": 5,
        "label": "Máx. de fotos candidatas",
        "help": "Quantas fotos de set a IA considera ao sugerir inserções.",
        "help_tech": "MAX_CANDIDATE_PHOTOS no build_candidates_context.",
        "category": "timeline", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "timeline.max_frames_per_clip", "type": "int", "default": 8, "min": 1, "max": 30, "step": 1,
        "label": "Máx. de frames descritos por clipe",
        "help": "Quantas descrições visuais por clipe entram no contexto enviado à IA.",
        "help_tech": "MAX_FRAMES_PER_CLIP no build_timeline_context.",
        "category": "timeline", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "timeline.min_gap_s", "type": "float", "default": 3.0, "min": 0.5, "max": 30.0, "step": 0.5,
        "label": "Lacuna mínima de cobertura (s)",
        "help": "Duração mínima de fala sem B-roll por cima para a IA apontar como lacuna a preencher.",
        "help_tech": "Filtro (g1-g0) >= X nas lacunas do build_timeline_context (e analyze_coverage do agente).",
        "category": "timeline", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "timeline.photo_default_duration", "type": "float", "default": 5.0, "min": 0.5, "max": 30.0, "step": 0.5,
        "label": "Duração padrão de foto (s)",
        "help": "Quanto tempo uma foto ocupa na timeline quando inserida sem duração definida.",
        "help_tech": "Substitui CONFIG.PHOTO_DEFAULT_DURATION.",
        "category": "timeline", "level": "pro", "scope": "both", "requires_reprocess": False,
    },

    # ── Agente & Chat ────────────────────────────────────────────────────────
    {
        "key": "agent.max_steps", "type": "int", "default": 8, "min": 1, "max": 25, "step": 1,
        "label": "Agente: máx. de passos",
        "help": "Quantas ações em sequência o agente pode executar por comando. Mais passos = tarefas mais complexas e mais custo.",
        "help_tech": "max_steps do loop de function-calling do chat_with_agent.",
        "category": "agent_chat", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "agent.temperature", "type": "float", "default": 0.3, "min": 0.0, "max": 2.0, "step": 0.05,
        "label": "Agente: criatividade (temperature)",
        "help": "Criatividade do agente de edição. Valores baixos deixam as ações mais previsíveis.",
        "help_tech": "temperature do payload do agente.",
        "category": "agent_chat", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "agent.timeout", "type": "int", "default": 40, "min": 10, "max": 300, "step": 5,
        "label": "Agente: timeout por passo (s)",
        "help": "Tempo máximo de espera por cada passo do agente.",
        "help_tech": "timeout do requests.post no loop do agente.",
        "category": "agent_chat", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "agent.history_window", "type": "int", "default": 6, "min": 0, "max": 30, "step": 1,
        "label": "Agente: janela de histórico",
        "help": "Quantas mensagens anteriores do chat o agente relembra a cada comando.",
        "help_tech": "history[-N:] no chat_with_agent.",
        "category": "agent_chat", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "chat.temperature", "type": "float", "default": 0.5, "min": 0.0, "max": 2.0, "step": 0.05,
        "label": "Chat: criatividade (temperature)",
        "help": "Criatividade das respostas do assistente de chat (RAG).",
        "help_tech": "temperature do RAGService.chat.",
        "category": "agent_chat", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "chat.timeout", "type": "int", "default": 30, "min": 5, "max": 300, "step": 5,
        "label": "Chat: timeout (s)",
        "help": "Tempo máximo de espera por resposta do chat.",
        "help_tech": "timeout do requests.post do RAGService.chat.",
        "category": "agent_chat", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "chat.history_window", "type": "int", "default": 8, "min": 0, "max": 30, "step": 1,
        "label": "Chat: janela de histórico",
        "help": "Quantas mensagens anteriores o chat relembra em cada resposta.",
        "help_tech": "history[-N:] no RAGService.chat.",
        "category": "agent_chat", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "chat.search_limit", "type": "int", "default": 15, "min": 3, "max": 50, "step": 1,
        "label": "Chat: resultados de busca no contexto",
        "help": "Quantos trechos do acervo são buscados para embasar cada resposta do chat.",
        "help_tech": "limit do search_hybrid no RAGService.chat.",
        "category": "agent_chat", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "chat.categorize_temperature", "type": "float", "default": 0.3, "min": 0.0, "max": 2.0, "step": 0.05,
        "label": "Categorização de busca: temperature",
        "help": "Criatividade da IA ao agrupar resultados de busca em categorias.",
        "help_tech": "temperature do categorize_results_with_llm.",
        "category": "agent_chat", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "chat.categorize_timeout", "type": "int", "default": 20, "min": 5, "max": 120, "step": 5,
        "label": "Categorização de busca: timeout (s)",
        "help": "Tempo máximo de espera pela categorização dos resultados de busca.",
        "help_tech": "timeout do categorize_results_with_llm.",
        "category": "agent_chat", "level": "pro", "scope": "both", "requires_reprocess": False,
    },

    # ── Temas & Busca ────────────────────────────────────────────────────────
    {
        "key": "clip.enabled", "type": "bool", "default": True,
        "label": "Busca visual local (CLIP)",
        "help": "Indexa keyframes e fotos com um modelo visual local: busca por conceito de imagem ('contraluz na janela') sem custo de API. Usa ~1GB de RAM quando ativo.",
        "help_tech": "Liga a indexação em capiau_images (ImageSearch) e a fusão visual no search_hybrid.",
        "category": "themes_search", "level": "simple", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "burst.enabled", "type": "bool", "default": True,
        "label": "Agrupar rajadas de fotos",
        "help": "Fotos quase idênticas tiradas em sequência viram um grupo: a IA analisa só uma e as demais herdam a descrição. Uma rajada de 20 fotos custa 1 chamada em vez de 20. Todas continuam visíveis na biblioteca.",
        "help_tech": "Liga o group_photo_bursts (CLIP local) no analyze-all-vision; grava photo.burst_group_id.",
        "category": "themes_search", "level": "simple", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "burst.similarity_threshold", "type": "float", "default": 0.97, "min": 0.80, "max": 0.999, "step": 0.005,
        "label": "Rajadas: similaridade mínima",
        "help": "Quão parecidas duas fotos precisam ser para entrarem na mesma rajada. Menor = agrupa mais (e arrisca juntar fotos diferentes); maior = só quadros praticamente idênticos.",
        "help_tech": "Cosseno mínimo entre embeddings CLIP da foto e da líder do grupo corrente.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "burst.time_window_s", "type": "int", "default": 30, "min": 0, "max": 600, "step": 5,
        "label": "Rajadas: janela de tempo (s)",
        "help": "Intervalo máximo entre duas fotos da mesma pasta para que possam formar uma rajada. 0 = ignora o tempo e agrupa só por semelhança visual.",
        "help_tech": "Diferença máxima de mtime entre foto e líder do grupo; 0 desliga o critério temporal.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "burst.max_group_size", "type": "int", "default": 30, "min": 2, "max": 200, "step": 1,
        "label": "Rajadas: tamanho máximo do grupo",
        "help": "Teto de fotos por rajada. Atingido o limite, a próxima foto abre um grupo novo (e é analisada).",
        "help_tech": "Corta o encadeamento em group_photo_bursts.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "search.image_weight", "type": "float", "default": 0.5, "min": 0.0, "max": 2.0, "step": 0.05,
        "label": "Busca: peso dos resultados visuais",
        "help": "Quanto os matches visuais (CLIP) pesam na fusão com os resultados de texto. 0 = ignora busca visual.",
        "help_tech": "Peso do ranking visual na fusão do search_hybrid (antes do MMR).",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "search.mmr_lambda", "type": "float", "default": 0.7, "min": 0.0, "max": 1.0, "step": 0.05,
        "label": "Busca: relevância × diversidade (MMR)",
        "help": "Equilíbrio dos resultados de busca: 1.0 = só relevância (resultados podem se repetir), 0.0 = máxima variedade. O padrão 0.7 evita listas de resultados quase idênticos.",
        "help_tech": "Lambda do re-ranking MMR aplicado em RAGService.search_hybrid antes da paginação.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "themes.match_threshold", "type": "float", "default": 0.60, "min": 0.3, "max": 0.95, "step": 0.01,
        "label": "Temas: similaridade p/ atribuição",
        "help": "Semelhança mínima para um trecho novo entrar num tema já existente. Maior = temas mais rígidos.",
        "help_tech": "THEME_MATCH_THRESHOLD do theme_engine v2.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "themes.cluster_distance", "type": "float", "default": 0.45, "min": 0.1, "max": 0.9, "step": 0.01,
        "label": "Temas: distância máx. de agrupamento",
        "help": "Distância máxima entre trechos para caírem no mesmo grupo. Menor = mais temas, menores.",
        "help_tech": "CLUSTER_DISTANCE_THRESHOLD (1 - similaridade cosseno).",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "themes.min_item_chars", "type": "int", "default": 40, "min": 0, "max": 500, "step": 10,
        "label": "Temas: mín. de caracteres por trecho",
        "help": "Trechos mais curtos que isso são ignorados como ruído.",
        "help_tech": "MIN_ITEM_CHARS do theme_engine v2.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "themes.max_clusters", "type": "int", "default": 40, "min": 5, "max": 200, "step": 5,
        "label": "Temas: teto de grupos por rodada",
        "help": "Número máximo de grupos criados por clusterização (mantém os maiores).",
        "help_tech": "MAX_CLUSTERS do theme_engine v2.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "themes.naming_batch_size", "type": "int", "default": 18, "min": 4, "max": 60, "step": 2,
        "label": "Temas: grupos por chamada de nomeação",
        "help": "Quantos grupos são nomeados pela IA por chamada. Maior = menos chamadas e mais custo por chamada.",
        "help_tech": "NAMING_BATCH_SIZE do theme_engine v2.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "themes.title_merge_threshold", "type": "float", "default": 0.82, "min": 0.5, "max": 0.99, "step": 0.01,
        "label": "Temas: fusão por título",
        "help": "Semelhança mínima entre títulos para dois temas serem fundidos.",
        "help_tech": "TITLE_MERGE_THRESHOLD (embeddings dos títulos).",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "themes.centroid_merge_threshold", "type": "float", "default": 0.86, "min": 0.5, "max": 0.99, "step": 0.01,
        "label": "Temas: fusão por conteúdo",
        "help": "Semelhança mínima entre conteúdos para dois temas serem fundidos.",
        "help_tech": "CENTROID_MERGE_THRESHOLD (centroides de conteúdo).",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "themes.naming_temperature", "type": "float", "default": 0.3, "min": 0.0, "max": 2.0, "step": 0.05,
        "label": "Temas: criatividade da nomeação",
        "help": "Criatividade da IA ao dar títulos e descrições aos temas.",
        "help_tech": "temperature da chamada de nomeação de clusters.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "themes.naming_timeout", "type": "int", "default": 90, "min": 10, "max": 300, "step": 10,
        "label": "Temas: timeout da nomeação (s)",
        "help": "Tempo máximo de espera por lote de nomeação de temas.",
        "help_tech": "timeout do requests.post da nomeação.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "enrichment.temperature", "type": "float", "default": 0.1, "min": 0.0, "max": 2.0, "step": 0.05,
        "label": "Enriquecimento: temperature",
        "help": "Criatividade da IA ao reescrever descrições com nomes reais. Baixo = mais fiel ao original.",
        "help_tech": "temperature do rewrite_description_llm.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "enrichment.timeout", "type": "int", "default": 25, "min": 5, "max": 120, "step": 5,
        "label": "Enriquecimento: timeout (s)",
        "help": "Tempo máximo de espera por reescrita de descrição.",
        "help_tech": "timeout do rewrite_description_llm.",
        "category": "themes_search", "level": "pro", "scope": "both", "requires_reprocess": False,
    },

    # ── Rostos ───────────────────────────────────────────────────────────────
    {
        "key": "faces.detector_score", "type": "float", "default": 0.6, "min": 0.1, "max": 0.95, "step": 0.05,
        "label": "Confiança mínima de detecção",
        "help": "Quão confiante o detector precisa estar para registrar um rosto. Menor = detecta mais rostos (e mais falsos positivos). Afeta apenas novas detecções.",
        "help_tech": "score_threshold do YuNet e filtro confidence < X no detect_and_embed_faces.",
        "category": "faces", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "faces.nms_threshold", "type": "float", "default": 0.3, "min": 0.1, "max": 0.9, "step": 0.05,
        "label": "Supressão de detecções sobrepostas (NMS)",
        "help": "Controle técnico de como detecções sobrepostas do mesmo rosto são fundidas. Afeta apenas novas detecções.",
        "help_tech": "nms_threshold do YuNet (FaceDetectorYN).",
        "category": "faces", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "faces.blur_threshold", "type": "float", "default": 15.0, "min": 1.0, "max": 100.0, "step": 1.0,
        "label": "Limite de desfoque",
        "help": "Rostos mais borrados que este limite podem ser descartados em cenas com multidão. Afeta apenas novas detecções.",
        "help_tech": "Variância do Laplaciano em is_blurry.",
        "category": "faces", "level": "pro", "scope": "both", "requires_reprocess": True,
    },
    {
        "key": "faces.dbscan_eps", "type": "float", "default": 0.38, "min": 0.1, "max": 0.9, "step": 0.01,
        "label": "Agrupamento: distância máxima (eps)",
        "help": "Distância máxima entre rostos para caírem no mesmo grupo de pessoa. Menor = grupos mais rígidos.",
        "help_tech": "eps do cluster_faces_dbscan (também ajustável no painel de Rostos).",
        "category": "faces", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "faces.dbscan_min_samples", "type": "int", "default": 2, "min": 1, "max": 15, "step": 1,
        "label": "Agrupamento: mín. de rostos por grupo",
        "help": "Quantos rostos parecidos são necessários para formar um grupo de pessoa.",
        "help_tech": "min_samples do cluster_faces_dbscan.",
        "category": "faces", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
    {
        "key": "faces.recognition_confidence", "type": "float", "default": 0.7, "min": 0.3, "max": 0.99, "step": 0.01,
        "label": "Confiança mínima de reconhecimento",
        "help": "Quão parecido um rosto precisa ser de uma pessoa conhecida para ser reconhecido automaticamente.",
        "help_tech": "confidence_threshold do FacePipeline em cascata.",
        "category": "faces", "level": "pro", "scope": "both", "requires_reprocess": False,
    },
]

# ── Presets do modo simples ──────────────────────────────────────────────────
# "equilibrado" = defaults do código: aplicá-lo equivale a remover os overrides
# das chaves cobertas pelos demais presets.

PRESETS = {
    "economico": {
        "label": "Econômico",
        "description": "Menos chamadas de IA e contextos menores: mais barato, análises mais grosseiras.",
        "values": {
            "vision.frame_interval": 20,
            "timeline.max_suggestions": 3,
            "timeline.max_candidate_videos": 15,
            "timeline.max_candidate_photos": 8,
            "timeline.max_frames_per_clip": 5,
            "chat.search_limit": 10,
            "agent.max_steps": 5,
            "agent.history_window": 4,
            "chat.history_window": 6,
            "summary.transcript_max_chars": 15000,
            "themes.naming_batch_size": 24,
            "burst.similarity_threshold": 0.95,
        },
    },
    "equilibrado": {
        "label": "Equilibrado",
        "description": "Comportamento padrão do app: bom custo-benefício.",
        "values": {},
    },
    "maxima_qualidade": {
        "label": "Máxima Qualidade",
        "description": "Mais contexto, mais candidatos e análise mais fina: melhores resultados, maior custo.",
        "values": {
            "vision.frame_interval": 5,
            "timeline.max_suggestions": 5,
            "timeline.max_candidate_videos": 40,
            "timeline.max_candidate_photos": 25,
            "timeline.max_frames_per_clip": 12,
            "chat.search_limit": 20,
            "agent.max_steps": 12,
            "agent.history_window": 10,
            "chat.history_window": 12,
            "summary.transcript_max_chars": 40000,
            "themes.naming_batch_size": 12,
            "burst.similarity_threshold": 0.985,
        },
    },
}

# ── Helpers ──────────────────────────────────────────────────────────────────

_REGISTRY_MAP: Optional[Dict[str, Dict[str, Any]]] = None


def get_registry_map() -> Dict[str, Dict[str, Any]]:
    """Índice memoizado key -> entrada do catálogo."""
    global _REGISTRY_MAP
    if _REGISTRY_MAP is None:
        _REGISTRY_MAP = {e["key"]: e for e in SETTINGS_REGISTRY}
    return _REGISTRY_MAP


def preset_covered_keys() -> set:
    """União das chaves tocadas por qualquer preset (usada na detecção de preset ativo)."""
    keys = set()
    for p in PRESETS.values():
        keys.update(p["values"].keys())
    return keys


def mask_secret(value: str) -> str:
    """Mascara uma chave de API para exibição (o valor real nunca volta ao cliente)."""
    if not value:
        return ""
    if len(value) > 14:
        return value[:7] + "…" + value[-4:]
    return "•••"


def validate_value(key: str, value: Any) -> Tuple[bool, Any]:
    """Valida e coage um valor vindo do cliente para o tipo/limites do catálogo.

    Retorna (True, valor_coagido) ou (False, mensagem_de_erro). Nunca confia no
    cliente: number inputs mandam strings, sliders mandam floats para ints etc.
    """
    entry = get_registry_map().get(key)
    if entry is None:
        return False, f"Configuração desconhecida: '{key}'"

    stype = entry["type"]
    try:
        if stype == "bool":
            if isinstance(value, bool):
                coerced = value
            elif isinstance(value, str):
                coerced = value.strip().lower() in ("true", "1", "yes", "on")
            else:
                coerced = bool(value)
        elif stype == "int":
            coerced = int(float(value))
        elif stype == "float":
            coerced = float(value)
        elif stype in ("string", "secret"):
            if not isinstance(value, str):
                return False, f"'{key}' deve ser texto"
            coerced = value.strip()
        elif stype == "enum":
            coerced = str(value)
            if coerced not in (entry.get("enum") or []):
                return False, f"'{key}': valor '{coerced}' fora das opções permitidas"
        else:
            return False, f"'{key}': tipo de configuração inválido no catálogo"
    except (TypeError, ValueError):
        return False, f"'{key}': valor '{value}' inválido para o tipo {stype}"

    if stype in ("int", "float"):
        if entry.get("min") is not None and coerced < entry["min"]:
            return False, f"'{key}': mínimo permitido é {entry['min']}"
        if entry.get("max") is not None and coerced > entry["max"]:
            return False, f"'{key}': máximo permitido é {entry['max']}"

    # Settings que carregam JSON: rejeitar na escrita em vez de ignorar em silêncio
    # na hora da análise (um typo aqui viraria "o perfil não pegou e ninguém viu").
    if entry.get("json_map") == "effort_overrides":
        from src.services.analysis_policy import validate_overrides
        ok, err = validate_overrides(coerced)
        if not ok:
            return False, f"'{key}': {err}"

    return True, coerced
