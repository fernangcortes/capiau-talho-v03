"""Schema de Banco de Dados SQLite para o CaIAu Talho Making Of MVP."""
import sqlite3
from pathlib import Path
from src.config import CONFIG

SCHEMA_SQL = """
-- Projetos (Making Of de Documentário)
CREATE TABLE IF NOT EXISTS project (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    drive_link TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vídeos (Entrevistas e B-rolls de bastidores)
CREATE TABLE IF NOT EXISTS video (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    hash TEXT UNIQUE NOT NULL,
    video_type TEXT CHECK(video_type IN ('interview', 'broll', 'unknown')) DEFAULT 'unknown',
    
    -- Metadados técnicos (FFprobe)
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

-- Documentos de Contexto de Produção (Roteiros, Pautas, Fountain, FDX, etc.)
CREATE TABLE IF NOT EXISTS production_doc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    filepath TEXT,
    content TEXT NOT NULL,
    doc_type TEXT CHECK(doc_type IN ('script', 'outline', 'notes', 'other')) DEFAULT 'other',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rostos Identificados (Face Recognition)
CREATE TABLE IF NOT EXISTS face (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name TEXT, -- Nome da pessoa (ex: "Diretor Carlos"), NULL se não rotulado
    cluster_id INTEGER, -- ID do grupo similar (DBSCAN), NULL se ruído ou não clusterizado
    bounding_box TEXT, -- JSON com coordenadas [x, y, w, h] relativas
    photo_id INTEGER REFERENCES photo(id) ON DELETE CASCADE,
    video_id INTEGER REFERENCES video(id) ON DELETE CASCADE,
    timestamp REAL, -- Timestamp do frame para vídeos, NULL para fotos
    embedding TEXT, -- JSON array do vetor de embedding facial (ex: 128 floats)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transcrição Palavra-a-Palavra (diarizada e indexada)
CREATE TABLE IF NOT EXISTS transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES video(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    start_time REAL NOT NULL, -- em segundos
    end_time REAL NOT NULL,   -- em segundos
    speaker_id TEXT NOT NULL, -- ID do falante diarizado (ex: "Speaker A")
    confidence REAL DEFAULT 1.0,
    search_text TEXT -- normalizada para buscas rápidas
);

-- Temas e Tópicos narrativos extraídos por clustering
CREATE TABLE IF NOT EXISTS theme (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    title TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de ligação Muitos-para-Muitos: Segmento de transcrição <-> Tema
CREATE TABLE IF NOT EXISTS transcript_theme (
    transcript_id INTEGER NOT NULL REFERENCES transcript(id) ON DELETE CASCADE,
    theme_id INTEGER NOT NULL REFERENCES theme(id) ON DELETE CASCADE,
    relevance REAL DEFAULT 1.0,
    PRIMARY KEY (transcript_id, theme_id)
);

-- Linha de Tempo / Timeline (Pré-edições / Rascunhos de corte)
CREATE TABLE IF NOT EXISTS timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    sequence_json TEXT NOT NULL, -- JSON contendo a sequência ordenada: [{video_id, in, out, track}, ...]
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Grafo Relacional (Triplas RDF-like para matches, continuidades e tags)
CREATE TABLE IF NOT EXISTS relation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    subject_type TEXT CHECK(subject_type IN ('video', 'photo', 'theme', 'speaker')) NOT NULL,
    subject_id TEXT NOT NULL, -- ID do objeto (pode ser o ID numérico ou string como "Speaker A")
    predicate TEXT NOT NULL,   -- ex: 'features_speaker', 'matches_broll', 'belongs_to_theme'
    object_type TEXT CHECK(object_type IN ('video', 'photo', 'theme', 'speaker')) NOT NULL,
    object_id TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_video_project ON video(project_id);
CREATE INDEX IF NOT EXISTS idx_video_hash ON video(hash);
CREATE INDEX IF NOT EXISTS idx_photo_project ON photo(project_id);
CREATE INDEX IF NOT EXISTS idx_transcript_video ON transcript(video_id);
CREATE INDEX IF NOT EXISTS idx_transcript_time ON transcript(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_relation_subject ON relation(project_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_relation_object ON relation(project_id, object_type, object_id);
"""

def init_db(db_path: Path = None):
    """Inicializa o banco de dados SQLite com as tabelas do schema e realiza migrações dinâmicas."""
    if db_path is None:
        db_path = CONFIG.DB_PATH
        
    db_path.parent.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        
        # Migração dinâmica de colunas para o banco de dados existente
        cursor = conn.cursor()
        
        # Migrações para tabela project
        cursor.execute("PRAGMA table_info(project)")
        project_cols = [row[1] for row in cursor.fetchall()]
        if "drive_link" not in project_cols:
            cursor.execute("ALTER TABLE project ADD COLUMN drive_link TEXT")
            print("[MIGRATION] Coluna 'drive_link' adicionada à tabela project.")
            
        # Migrações para tabela face
        cursor.execute("PRAGMA table_info(face)")
        face_cols = [row[1] for row in cursor.fetchall()]
        if "cluster_id" not in face_cols:
            cursor.execute("ALTER TABLE face ADD COLUMN cluster_id INTEGER")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_face_project_cluster ON face(project_id, cluster_id)")
            print("[MIGRATION] Coluna 'cluster_id' e índice adicionados à tabela face.")
            
        # Migrações para tabela video
        cursor.execute("PRAGMA table_info(video)")
        video_cols = [row[1] for row in cursor.fetchall()]
        
        if "description" not in video_cols:
            cursor.execute("ALTER TABLE video ADD COLUMN description TEXT")
            print("[MIGRATION] Coluna 'description' adicionada à tabela video.")
        if "summary" not in video_cols:
            cursor.execute("ALTER TABLE video ADD COLUMN summary TEXT")
            print("[MIGRATION] Coluna 'summary' adicionada à tabela video.")
        if "tags" not in video_cols:
            cursor.execute("ALTER TABLE video ADD COLUMN tags TEXT")
            print("[MIGRATION] Coluna 'tags' adicionada à tabela video.")
            
        conn.commit()
        
        # Inserir projeto padrão se a tabela estiver vazia
        cursor.execute("SELECT COUNT(*) FROM project")
        if cursor.fetchone()[0] == 0:
            cursor.execute("INSERT INTO project (name, description) VALUES (?, ?)", 
                           ("Making Of MVP", "Projeto principal de decupagem e edição do making of."))
            conn.commit()
            print("[DB] Projeto inicial 'Making Of MVP' criado com sucesso.")
            
        print(f"[DB] Banco de dados inicializado em: {db_path}")
    except Exception as e:
        print(f"[DB] Erro crítico ao inicializar o banco de dados: {e}")
        raise e
    finally:
        conn.close()

if __name__ == "__main__":
    init_db()
