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
    description TEXT,
    tags TEXT, -- JSON array de tags visuais
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
            
        conn.commit()
        
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
