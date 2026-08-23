"""Schema de Banco de Dados SQLite para o CapIAu-Talho Making Of MVP."""
import sqlite3
from pathlib import Path
from src.config import CONFIG

SCHEMA_SQL = """
-- Projetos (Making Of de Documentario)
CREATE TABLE IF NOT EXISTS project (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    drive_link TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Videos (Entrevistas e B-rolls de bastidores)
CREATE TABLE IF NOT EXISTS video (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    hash TEXT UNIQUE NOT NULL,
    video_type TEXT CHECK(video_type IN ('interview', 'broll', 'unknown')) DEFAULT 'unknown',
    
    -- Metadados tecnicos (FFprobe)
    duration REAL,
    fps REAL,
    resolution TEXT,
    codec TEXT,
    bitrate INTEGER,
    
    -- Metadados editoriais / de IA
    title TEXT,       -- titulo curto (3-6 palavras) gerado pela IA
    category TEXT,    -- categoria de triagem (Eixo A: obra, processo, depoimento, ...)
    category_confidence REAL,
    description TEXT,
    summary TEXT,
    tags TEXT, -- JSON array de tags gerais

    -- Status no pipeline
    status TEXT CHECK(status IN ('pending', 'ingested', 'transcribing', 'transcribed', 'analyzing', 'analyzed', 'error')) DEFAULT 'pending',
    error_message TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fotos de Set (Bastidores)
CREATE TABLE IF NOT EXISTS photo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    hash TEXT UNIQUE NOT NULL,
    title TEXT,       -- titulo curto (3-6 palavras) gerado pela IA
    category TEXT,    -- categoria de triagem (Eixo A)
    category_confidence REAL,
    description TEXT,
    tags TEXT, -- JSON array de tags visuais
    burst_group_id INTEGER, -- id da foto lider da rajada (a unica analisada por API); NULL = foto isolada
    status TEXT CHECK(status IN ('pending', 'ingested', 'analyzed', 'error')) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Documentos de Contexto de Producao (Roteiros, Pautas, Fountain, FDX, etc.)
CREATE TABLE IF NOT EXISTS production_doc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    filepath TEXT,
    content TEXT NOT NULL,
    doc_type TEXT CHECK(doc_type IN ('script', 'outline', 'notes', 'other')) DEFAULT 'other',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rostos Detectados (Face Detection) - ENTIDADE FISICA, independente do modelo
-- Cada rosto eh uma deteccao fisica em um frame/foto
CREATE TABLE IF NOT EXISTS face (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    cluster_id INTEGER, -- ID do grupo similar (DBSCAN), NULL se ruido ou nao clusterizado
    name TEXT, -- Nome da pessoa (cache de exibicao), NULL se nao rotulado
    bounding_box TEXT, -- JSON com coordenadas [x, y, w, h] relativas
    photo_id INTEGER REFERENCES photo(id) ON DELETE CASCADE,
    video_id INTEGER REFERENCES video(id) ON DELETE CASCADE,
    timestamp REAL, -- Timestamp do frame para videos, NULL para fotos
    
    -- Quality metrics (pre-computados na deteccao)
    quality_score REAL, -- score de qualidade da imagem (0-1)
    blur_score REAL, -- variancia do Laplaciano
    face_size_px INTEGER, -- tamanho do rosto em pixels
    
    -- Crop do rosto (path para arquivo recortado)
    crop_path TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reconhecimentos Faciais (Face Recognitions) - EVENTOS VERSIONADOS
-- Cada face pode ter MULTIPLOS reconhecimentos (um por tier/modelo)
-- Essa tabela evita conflitos entre diferentes APIs e modelos
CREATE TABLE IF NOT EXISTS face_recognition (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    face_id INTEGER NOT NULL REFERENCES face(id) ON DELETE CASCADE,
    
    -- QUAL TIER/MODEL/API FOI USADO
    tier INTEGER CHECK(tier BETWEEN 0 AND 4),
    model TEXT, -- 'yunet_sface', 'azure_face', 'aws_rekognition', 'insightface_buffalo_l', 'manual'
    model_version TEXT, -- 'v1.0', '2025-01', etc.
    
    -- RESULTADO
    person_id INTEGER REFERENCES person(id), -- NULL se nao identificado
    embedding TEXT, -- JSON array do vetor de embedding (dimensao varia por modelo)
    similarity REAL, -- score de match (0-1)
    confidence REAL, -- confianca do modelo (0-1)
    
    -- METADADOS DO RECONHECIMENTO
    status TEXT CHECK(status IN ('auto', 'reviewed', 'confirmed', 'rejected', 'superseded')) DEFAULT 'auto',
    recognized_by TEXT, -- user_id ou NULL (sistema)
    recognized_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- RAW RESPONSE (para debug/audit)
    raw_response TEXT, -- JSON string
    
    -- Custo (para tracking de gastos com APIs pagas)
    cost_usd REAL DEFAULT 0.0,
    processing_time_ms INTEGER -- tempo de processamento em milissegundos
);

-- Pessoas Identificadas (entidade consolidada)
CREATE TABLE IF NOT EXISTS person (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name TEXT,
    aliases TEXT, -- JSON array de apelidos
    bio TEXT,
    profile_image_path TEXT,
    metadata TEXT, -- JSON com dados diversos
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transcricao Palavra-a-Palavra (diarizada e indexada)
CREATE TABLE IF NOT EXISTS transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES video(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    start_time REAL NOT NULL, -- em segundos
    end_time REAL NOT NULL,   -- em segundos
    speaker_id TEXT NOT NULL, -- ID do falante diarizado (ex: "Speaker A")
    confidence REAL DEFAULT 1.0,
    search_text TEXT -- normalizada para buscas rapidas
);

-- Temas e Topicos narrativos extraidos por clustering
CREATE TABLE IF NOT EXISTS theme (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    title TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de ligacao Muitos-para-Muitos: Segmento de transcricao <-> Tema
CREATE TABLE IF NOT EXISTS transcript_theme (
    transcript_id INTEGER NOT NULL REFERENCES transcript(id) ON DELETE CASCADE,
    theme_id INTEGER NOT NULL REFERENCES theme(id) ON DELETE CASCADE,
    relevance REAL DEFAULT 1.0,
    PRIMARY KEY (transcript_id, theme_id)
);

-- Linha de Tempo / Timeline (Pre-edicoes / Rascunhos de corte)
CREATE TABLE IF NOT EXISTS timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    sequence_json TEXT NOT NULL, -- JSON contendo a sequencia ordenada: [{video_id, in, out, track}, ...]
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Entidades Nomeadas (Pessoas, Objetos/Equipamentos, Locacoes)
-- Registro canonico usado para enriquecer descricoes de visao e busca
CREATE TABLE IF NOT EXISTS entity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    entity_type TEXT CHECK(entity_type IN ('person','object','location','other')) DEFAULT 'other',
    name TEXT NOT NULL,
    aliases TEXT, -- JSON array de apelidos/sinonimos
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, name)
);

-- Mencoes de Entidades em midias (fotos, frames de video)
-- Cada mencao registra ONDE e COMO a entidade foi vista/identificada
CREATE TABLE IF NOT EXISTS entity_mention (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL,
    photo_id INTEGER REFERENCES photo(id) ON DELETE CASCADE,
    video_id INTEGER REFERENCES video(id) ON DELETE CASCADE,
    timestamp REAL, -- timestamp do frame para videos, NULL para fotos
    source TEXT CHECK(source IN ('vision_auto','face_recognition','human_audit','text_link')) DEFAULT 'human_audit',
    status TEXT CHECK(status IN ('auto','confirmed','rejected')) DEFAULT 'confirmed',
    text_to_replace TEXT, -- trecho literal da descricao a substituir pelo nome (opcional)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Segmentos Tematicos: liga um tema a um TRECHO exato de midia (nao ao video inteiro)
CREATE TABLE IF NOT EXISTS theme_segment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id INTEGER NOT NULL REFERENCES theme(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL,
    video_id INTEGER REFERENCES video(id) ON DELETE CASCADE,
    photo_id INTEGER REFERENCES photo(id) ON DELETE CASCADE,
    start_time REAL, -- inicio do trecho em segundos (NULL para fotos)
    end_time REAL,
    speaker_id TEXT,
    text_excerpt TEXT, -- amostra do texto do segmento para exibicao
    relevance REAL DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Segmentos de Mídia (Shots/Cortes e Beats de Decupagem)
CREATE TABLE IF NOT EXISTS media_segment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL REFERENCES video(id) ON DELETE CASCADE,
    kind TEXT CHECK(kind IN ('shot', 'beat')) NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    reason TEXT,
    motion_label TEXT,
    shot_scale TEXT,        -- escala de plano zero-shot CLIP (E2.D1): detalhe|close|plano_medio|plano_americano|plano_geral|aereo
    shot_scale_score REAL,  -- similaridade cosseno do rotulo vencedor (diagnostico/calibracao)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Correcoes humanas de triagem (E2.C2): registro do erro -> acerto.
-- O E2.C3 consome as ultimas correcoes como few-shot no prompt de triagem.
CREATE TABLE IF NOT EXISTS triage_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    media_kind TEXT CHECK(media_kind IN ('video', 'photo')) NOT NULL,
    media_id INTEGER NOT NULL,
    wrong_category TEXT,          -- categoria que a IA tinha dado (NULL = triagem falhou/sem categoria)
    right_category TEXT NOT NULL, -- categoria corrigida pelo humano
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cenas extraidas de um roteiro (P2). O numero NAO vem do LLM: e atribuido
-- deterministicamente pela posicao da cena no documento (script_format.py), porque
-- roteiros reais frequentemente nao tem numeracao no texto e headings se repetem.
CREATE TABLE IF NOT EXISTS scene (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    doc_id INTEGER NOT NULL REFERENCES production_doc(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    heading TEXT,
    synopsis TEXT,
    characters_json TEXT, -- JSON array de nomes
    props_json TEXT,      -- JSON array de objetos manipulados na cena
    location TEXT,
    status TEXT CHECK(status IN ('suggested','confirmed','rejected')) DEFAULT 'suggested',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(doc_id, number)
);

-- Rodada de extracao de roteiro: serve de cache (por content_hash, P2.3) e de
-- registro de custo (convencao "custo visivel" do plano).
CREATE TABLE IF NOT EXISTS script_extraction (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    doc_id INTEGER NOT NULL REFERENCES production_doc(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    status TEXT CHECK(status IN ('running','done','error')) DEFAULT 'running',
    strategy TEXT,  -- qual detector segmentou o documento (auditoria)
    model TEXT,
    chunks INTEGER DEFAULT 0,
    calls INTEGER DEFAULT 0,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Grafo Relacional (Triplas RDF-like para matches, continuidades e tags)
CREATE TABLE IF NOT EXISTS relation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    subject_type TEXT CHECK(subject_type IN ('video', 'photo', 'theme', 'speaker')) NOT NULL,
    subject_id TEXT NOT NULL, -- ID do objeto (pode ser o ID numerico ou string como "Speaker A")
    predicate TEXT NOT NULL,   -- ex: 'features_speaker', 'matches_broll', 'belongs_to_theme'
    object_type TEXT CHECK(object_type IN ('video', 'photo', 'theme', 'speaker')) NOT NULL,
    object_id TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices de performance
CREATE INDEX IF NOT EXISTS idx_segment_video ON media_segment(video_id);
CREATE INDEX IF NOT EXISTS idx_video_project ON video(project_id);
CREATE INDEX IF NOT EXISTS idx_video_hash ON video(hash);
CREATE INDEX IF NOT EXISTS idx_photo_project ON photo(project_id);
CREATE INDEX IF NOT EXISTS idx_face_project ON face(project_id);
CREATE INDEX IF NOT EXISTS idx_face_cluster ON face(project_id, cluster_id);
CREATE INDEX IF NOT EXISTS idx_face_video ON face(video_id);
CREATE INDEX IF NOT EXISTS idx_face_photo ON face(photo_id);
CREATE INDEX IF NOT EXISTS idx_recognition_face ON face_recognition(face_id);
CREATE INDEX IF NOT EXISTS idx_recognition_tier ON face_recognition(tier, model);
CREATE INDEX IF NOT EXISTS idx_recognition_person ON face_recognition(person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recognition_status ON face_recognition(status);
CREATE INDEX IF NOT EXISTS idx_person_project ON person(project_id);
CREATE INDEX IF NOT EXISTS idx_transcript_video ON transcript(video_id);
CREATE INDEX IF NOT EXISTS idx_transcript_time ON transcript(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_relation_subject ON relation(project_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_relation_object ON relation(project_id, object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_entity_project ON entity(project_id);
CREATE INDEX IF NOT EXISTS idx_mention_entity ON entity_mention(entity_id);
CREATE INDEX IF NOT EXISTS idx_mention_video ON entity_mention(video_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_mention_photo ON entity_mention(photo_id);
CREATE INDEX IF NOT EXISTS idx_theme_segment_theme ON theme_segment(theme_id);
CREATE INDEX IF NOT EXISTS idx_theme_segment_video ON theme_segment(video_id);
CREATE INDEX IF NOT EXISTS idx_triage_feedback_project ON triage_feedback(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_scene_project ON scene(project_id, doc_id, number);
CREATE INDEX IF NOT EXISTS idx_script_extraction_cache ON script_extraction(doc_id, content_hash, status);

-- Configurações da IA: apenas OVERRIDES (ausência de linha = default do código).
-- Resolução em camadas: default -> app_setting (global) -> project_setting (projeto).
CREATE TABLE IF NOT EXISTS app_setting (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_setting (
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, key)
);

-- Entidades detectadas na FALA pelo ASR (AssemblyAI entity_detection).
-- Separada de entity/entity_mention, que pertencem ao pipeline de visao/rostos
-- e usam um vocabulario proprio de 4 tipos. Aqui guardamos o rotulo cru da
-- AssemblyAI (50+ tipos) sem forcar traducao.
CREATE TABLE IF NOT EXISTS transcript_entity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES video(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL, -- rotulo cru da AssemblyAI (person_name, location, ...)
    text TEXT NOT NULL,        -- trecho literal como foi falado
    start_time REAL,           -- em segundos
    end_time REAL,             -- em segundos
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Historico da decupagem editorial (titulo/descricao/resumo/tags) de cada video.
-- Cada linha e uma versao ANTERIOR, arquivada automaticamente por
-- MediaRepository antes de qualquer sobrescrita. So a versao corrente vive na
-- tabela video -- e so ela alimenta a busca. Ver docs/PLANO_HISTORICO_METADADOS_E_WORKER_ASR.md
CREATE TABLE IF NOT EXISTS video_metadata_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES video(id) ON DELETE CASCADE,
    title TEXT,
    description TEXT,
    summary TEXT,
    tags TEXT,                 -- JSON, mesmo formato de video.tags
    origem TEXT CHECK(origem IN ('ia','humano','importado')) DEFAULT 'ia',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vmh_video ON video_metadata_history(video_id, created_at DESC);

-- Renderizacoes e analises de audio por intervalo de clipe
-- (docs/PLANO_AJUSTES_DE_AUDIO.md, secao 3 e Etapa 1). Na ETAPA 1 a linha guarda
-- so o diagnostico: chain_json='[]', status='ready' e
-- chain_hash = sha256("analysis|<video_id>|<in>|<out>") em hexdigest.
-- Da Etapa 3 em diante a mesma tabela passa a apontar o WAV tratado em path.
-- O indice unico garante uma linha por (video, cadeia): reaplicar a mesma
-- cadeia reusa o resultado em vez de reprocessar (mesma ideia dos proxies).
CREATE TABLE IF NOT EXISTS audio_render (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES video(id) ON DELETE CASCADE,
    in_s REAL,                -- inicio do intervalo analisado/renderizado (s); NULL = arquivo inteiro
    out_s REAL,               -- fim do intervalo (s)
    chain_hash TEXT NOT NULL, -- sha256 hexdigest que identifica (video, intervalo, cadeia)
    chain_json TEXT,          -- JSON array com a cadeia aplicada ('[]' na analise pura)
    path TEXT,                -- caminho do WAV derivado quando houver renderizacao
    status TEXT NOT NULL DEFAULT 'pending', -- pending|running|ready|failed
    analysis_json TEXT,       -- JSON com o diagnostico (lufs_i, lra, true_peak_db, ...)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_render_hash ON audio_render(video_id, chain_hash);
"""

def init_db(db_path: Path = None):
    """Inicializa o banco de dados SQLite com as tabelas do schema e realiza migracoes dinamicas."""
    if db_path is None:
        db_path = CONFIG.DB_PATH
        
    db_path.parent.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        
        # Migracao dinamica de colunas para o banco de dados existente
        cursor = conn.cursor()
        
        # Migracoes para tabela project
        cursor.execute("PRAGMA table_info(project)")
        project_cols = [row[1] for row in cursor.fetchall()]
        if "drive_link" not in project_cols:
            cursor.execute("ALTER TABLE project ADD COLUMN drive_link TEXT")
            print("[MIGRATION] Coluna 'drive_link' adicionada a tabela project.")
            
        # Migracao: tabela face (nova estrutura versionada)
        cursor.execute("PRAGMA table_info(face)")
        face_cols = [row[1] for row in cursor.fetchall()]
        
        # Migracao legacy: embedding e name movidos de 'face' para 'face_recognition'
        if "embedding" in face_cols:
            # Embeddings antigos ainda estao na tabela face - vamos mante-los como legacy
            # mas a nova arquitetura usa face_recognition
            print("[MIGRATION] Detectada coluna 'embedding' legacy na tabela face.")
            print("[MIGRATION] Os embeddings existentes serao mantidos. A nova arquitetura versionada usa face_recognition.")
        
        if "cluster_id" not in face_cols:
            cursor.execute("ALTER TABLE face ADD COLUMN cluster_id INTEGER")
            print("[MIGRATION] Coluna 'cluster_id' adicionada a tabela face.")
        
        # Novas colunas de quality na tabela face
        if "quality_score" not in face_cols:
            cursor.execute("ALTER TABLE face ADD COLUMN quality_score REAL")
            print("[MIGRATION] Coluna 'quality_score' adicionada a tabela face.")
        if "blur_score" not in face_cols:
            cursor.execute("ALTER TABLE face ADD COLUMN blur_score REAL")
            print("[MIGRATION] Coluna 'blur_score' adicionada a tabela face.")
        if "face_size_px" not in face_cols:
            cursor.execute("ALTER TABLE face ADD COLUMN face_size_px INTEGER")
            print("[MIGRATION] Coluna 'face_size_px' adicionada a tabela face.")
        if "crop_path" not in face_cols:
            cursor.execute("ALTER TABLE face ADD COLUMN crop_path TEXT")
            print("[MIGRATION] Coluna 'crop_path' adicionada a tabela face.")
            
        # Migracoes para tabela video
        cursor.execute("PRAGMA table_info(video)")
        video_cols = [row[1] for row in cursor.fetchall()]
        
        if "description" not in video_cols:
            cursor.execute("ALTER TABLE video ADD COLUMN description TEXT")
            print("[MIGRATION] Coluna 'description' adicionada a tabela video.")
        if "summary" not in video_cols:
            cursor.execute("ALTER TABLE video ADD COLUMN summary TEXT")
            print("[MIGRATION] Coluna 'summary' adicionada a tabela video.")
        if "tags" not in video_cols:
            cursor.execute("ALTER TABLE video ADD COLUMN tags TEXT")
            print("[MIGRATION] Coluna 'tags' adicionada a tabela video.")
        # Triagem por categoria (Eixo A) e titulo curto gerado por IA
        if "title" not in video_cols:
            cursor.execute("ALTER TABLE video ADD COLUMN title TEXT")
            print("[MIGRATION] Coluna 'title' adicionada a tabela video.")
        if "category" not in video_cols:
            cursor.execute("ALTER TABLE video ADD COLUMN category TEXT")
            print("[MIGRATION] Coluna 'category' adicionada a tabela video.")
        if "category_confidence" not in video_cols:
            cursor.execute("ALTER TABLE video ADD COLUMN category_confidence REAL")
            print("[MIGRATION] Coluna 'category_confidence' adicionada a tabela video.")
        # Origem da decupagem CORRENTE ('ia' | 'humano' | 'importado'). Serve para
        # que video_metadata_history registre corretamente quem escreveu a versao
        # que esta sendo arquivada.
        if "metadata_origem" not in video_cols:
            cursor.execute("ALTER TABLE video ADD COLUMN metadata_origem TEXT DEFAULT 'ia'")
            print("[MIGRATION] Coluna 'metadata_origem' adicionada a tabela video.")

        # Migracoes para tabela photo (descricao original preservada antes do enriquecimento)
        cursor.execute("PRAGMA table_info(photo)")
        photo_cols = [row[1] for row in cursor.fetchall()]
        if "raw_description" not in photo_cols:
            cursor.execute("ALTER TABLE photo ADD COLUMN raw_description TEXT")
            print("[MIGRATION] Coluna 'raw_description' adicionada a tabela photo.")
        if "title" not in photo_cols:
            cursor.execute("ALTER TABLE photo ADD COLUMN title TEXT")
            print("[MIGRATION] Coluna 'title' adicionada a tabela photo.")
        if "category" not in photo_cols:
            cursor.execute("ALTER TABLE photo ADD COLUMN category TEXT")
            print("[MIGRATION] Coluna 'category' adicionada a tabela photo.")
        if "category_confidence" not in photo_cols:
            cursor.execute("ALTER TABLE photo ADD COLUMN category_confidence REAL")
            print("[MIGRATION] Coluna 'category_confidence' adicionada a tabela photo.")
        if "burst_group_id" not in photo_cols:
            cursor.execute("ALTER TABLE photo ADD COLUMN burst_group_id INTEGER")
            print("[MIGRATION] Coluna 'burst_group_id' adicionada a tabela photo.")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_photo_burst_group ON photo(project_id, burst_group_id)")
        if "palette_temp" not in photo_cols:
            cursor.execute("ALTER TABLE photo ADD COLUMN palette_temp TEXT")
            print("[MIGRATION] Coluna 'palette_temp' adicionada a tabela photo.")
        if "palette_hex" not in photo_cols:
            cursor.execute("ALTER TABLE photo ADD COLUMN palette_hex TEXT")
            print("[MIGRATION] Coluna 'palette_hex' adicionada a tabela photo.")

        # Migracoes para tabela theme (centroide de embedding e temas fixados pelo usuario)
        cursor.execute("PRAGMA table_info(theme)")
        theme_cols = [row[1] for row in cursor.fetchall()]
        if "embedding" not in theme_cols:
            cursor.execute("ALTER TABLE theme ADD COLUMN embedding TEXT")
            print("[MIGRATION] Coluna 'embedding' adicionada a tabela theme.")
        if "pinned" not in theme_cols:
            cursor.execute("ALTER TABLE theme ADD COLUMN pinned INTEGER DEFAULT 0")
            print("[MIGRATION] Coluna 'pinned' adicionada a tabela theme.")

        # Migracoes para tabela media_segment (escala de plano zero-shot, E2.D1)
        cursor.execute("PRAGMA table_info(media_segment)")
        segment_cols = [row[1] for row in cursor.fetchall()]
        if "shot_scale" not in segment_cols:
            cursor.execute("ALTER TABLE media_segment ADD COLUMN shot_scale TEXT")
            print("[MIGRATION] Coluna 'shot_scale' adicionada a tabela media_segment.")
        if "shot_scale_score" not in segment_cols:
            cursor.execute("ALTER TABLE media_segment ADD COLUMN shot_scale_score REAL")
            print("[MIGRATION] Coluna 'shot_scale_score' adicionada a tabela media_segment.")

        # Migracoes para tabela production_doc (dedupe/versao no upload, P1.1)
        cursor.execute("PRAGMA table_info(production_doc)")
        doc_cols = [row[1] for row in cursor.fetchall()]
        if "byte_hash" not in doc_cols:
            cursor.execute("ALTER TABLE production_doc ADD COLUMN byte_hash TEXT")
            print("[MIGRATION] Coluna 'byte_hash' adicionada a tabela production_doc.")
        if "content_hash" not in doc_cols:
            cursor.execute("ALTER TABLE production_doc ADD COLUMN content_hash TEXT")
            print("[MIGRATION] Coluna 'content_hash' adicionada a tabela production_doc.")
            # Backfill: docs existentes ganham content_hash calculado agora a partir do texto
            # ja persistido (os bytes originais nao foram guardados, entao byte_hash fica NULL
            # para linhas legadas - so vale para uploads novos).
            from src.db.repositories.projects import ProjectRepository
            cursor.execute("SELECT id, content FROM production_doc WHERE content IS NOT NULL")
            legacy_docs = cursor.fetchall()
            for legacy_id, legacy_content in legacy_docs:
                cursor.execute(
                    "UPDATE production_doc SET content_hash = ? WHERE id = ?",
                    (ProjectRepository.hash_doc_content(legacy_content), legacy_id)
                )
            if legacy_docs:
                print(f"[MIGRATION] content_hash calculado para {len(legacy_docs)} documento(s) existente(s) de production_doc.")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_production_doc_byte_hash ON production_doc(project_id, byte_hash)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_production_doc_content_hash ON production_doc(project_id, content_hash)")

        # Migracao para tabela entity (curadoria de entidades sugeridas pelo roteiro, P2.2).
        # Default 'confirmed' de proposito: as entidades que ja existem no banco vieram de
        # auditoria humana e devem continuar entrando nos prompts de visao/triagem. Apenas
        # o que o extrator de roteiro sugerir nasce como 'suggested'.
        cursor.execute("PRAGMA table_info(entity)")
        entity_cols = [row[1] for row in cursor.fetchall()]
        if "status" not in entity_cols:
            cursor.execute("ALTER TABLE entity ADD COLUMN status TEXT DEFAULT 'confirmed'")
            print("[MIGRATION] Coluna 'status' adicionada a tabela entity.")

        # Migracao E3.C (21/07): universo (producao real x obra ficcional), funcao na
        # producao e vinculo personagem->pessoa real. 'realm' e ortogonal a entity_type:
        # vale para pessoa (equipe x personagem), objeto (equipamento x prop diegetico)
        # e locacao (locacao fisica x cenario da obra) -- por isso e coluna propria, nao
        # um entity_type novo (o CHECK existente nao aceitaria valor novo sem recriar
        # a tabela).
        cursor.execute("PRAGMA table_info(entity)")
        entity_cols = [row[1] for row in cursor.fetchall()]
        if "realm" not in entity_cols:
            cursor.execute(
                "ALTER TABLE entity ADD COLUMN realm TEXT CHECK(realm IN ('production','story')) DEFAULT 'production'"
            )
            print("[MIGRATION] Coluna 'realm' adicionada a tabela entity.")
            # Backfill: toda entidade 'suggested' ate aqui veio do extrator de roteiro
            # (unica fonte que grava suggested) e representa elemento da OBRA, nao da
            # producao real. ALTER...DEFAULT preenche todas as linhas com 'production';
            # este UPDATE promove as suggested para 'story'.
            cursor.execute("UPDATE entity SET realm = 'story' WHERE status = 'suggested'")
            promoted = cursor.rowcount
            if promoted:
                print(f"[MIGRATION] {promoted} entidade(s) 'suggested' promovida(s) para realm='story'.")
        if "role" not in entity_cols:
            cursor.execute("ALTER TABLE entity ADD COLUMN role TEXT")
            print("[MIGRATION] Coluna 'role' adicionada a tabela entity.")
        if "linked_entity_id" not in entity_cols:
            cursor.execute("ALTER TABLE entity ADD COLUMN linked_entity_id INTEGER REFERENCES entity(id) ON DELETE SET NULL")
            print("[MIGRATION] Coluna 'linked_entity_id' adicionada a tabela entity.")

        conn.commit()
        
        # Limpeza automática de menções órfãs/stale de rostos que foram renomeados/mesclados no passado
        try:
            cursor.execute("""
                DELETE FROM entity_mention
                WHERE source IN ('face_recognition', 'human_audit')
                  AND (
                    -- Para fotos: não existe nenhuma face na mesma foto com o mesmo nome da entidade
                    (photo_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM face f
                        JOIN entity e ON e.id = entity_mention.entity_id
                        WHERE f.photo_id = entity_mention.photo_id
                          AND f.name IS NOT NULL
                          AND f.name != ''
                          AND f.name = e.name COLLATE NOCASE
                    ))
                    OR
                    -- Para vídeos: não existe nenhuma face no mesmo vídeo e timestamp aproximado com o mesmo nome da entidade
                    (video_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM face f
                        JOIN entity e ON e.id = entity_mention.entity_id
                        WHERE f.video_id = entity_mention.video_id
                          AND ABS(f.timestamp - entity_mention.timestamp) <= 0.1
                          AND f.name IS NOT NULL
                          AND f.name != ''
                          AND f.name = e.name COLLATE NOCASE
                    ))
                  )
            """)
            deleted_rows = cursor.rowcount
            if deleted_rows > 0:
                print(f"[MIGRATION] Limpeza do banco concluída: {deleted_rows} menções órfãs/stale de rostos foram removidas.")
                conn.commit()
        except Exception as cleanup_err:
            print(f"[MIGRATION] Falha ao executar limpeza automática de menções: {cleanup_err}")
        
        # Inserir projeto padrao se a tabela estiver vazia
        cursor.execute("SELECT COUNT(*) FROM project")
        if cursor.fetchone()[0] == 0:
            cursor.execute("INSERT INTO project (name, description) VALUES (?, ?)", 
                           ("Making Of MVP", "Projeto principal de decupagem e edicao do making of."))
            conn.commit()
            print("[DB] Projeto inicial 'Making Of MVP' criado com sucesso.")
            
        print(f"[DB] Banco de dados inicializado em: {db_path}")
    except Exception as e:
        print(f"[DB] Erro critico ao inicializar o banco de dados: {e}")
        raise e
    finally:
        conn.close()

if __name__ == "__main__":
    init_db()
