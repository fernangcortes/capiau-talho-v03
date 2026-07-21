"""Roteador FastAPI para gerenciamento de Projetos e Documentos de Contexto."""
import os
import re
import zipfile
import shutil
import tempfile
import json
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
import sqlite3

from src.config import CONFIG
from src.api.dependencies import get_db_conn
from src.api.schemas import ProjectCreate, ProjectDriveLinkUpdate, ProjectExportOptions
from src.db.repositories.projects import ProjectRepository
from src.services.sync import SyncService
from src.services.settings_service import SettingsService
from src.search.semantic import SemanticSearch

router = APIRouter(tags=["Projects"])

@router.post("/api/projects")
def create_project(project: ProjectCreate, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Cria um novo projeto de documentário ou making of."""
    try:
        project_id = ProjectRepository.create(conn, project.name, project.description)
        conn.commit()
        return {"status": "success", "project_id": project_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/projects")
def list_projects(conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna uma lista com todos os projetos cadastrados."""
    return ProjectRepository.list_all(conn)

@router.delete("/api/projects/{project_id}")
def remove_project(project_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Deleta um projeto e todas as suas mídias associadas no SQLite (em cascata)."""
    try:
        ProjectRepository.delete(conn, project_id)
        conn.commit()
        return {"status": "success", "message": f"Projeto {project_id} deletado com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/api/project/{project_id}/drive-link")
def update_drive_link(project_id: int, payload: ProjectDriveLinkUpdate, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Atualiza o link do Google Drive de referência do projeto."""
    try:
        ProjectRepository.update_drive_link(conn, project_id, payload.drive_link)
        conn.commit()
        return {"status": "success", "message": "Link do Drive atualizado."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/project/{project_id}/export")
def export_project(project_id: int, options: ProjectExportOptions):
    """Agrupa metadados e arquivos de mídia do projeto em um arquivo ZIP para download."""
    data = SyncService.get_project_all_data(project_id)
    if not data or not data["project"]:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
        
    project_name = data["project"]["name"].replace(" ", "_").lower()
    exports_dir = CONFIG.EXPORTS_DIR
    exports_dir.mkdir(parents=True, exist_ok=True)
    
    zip_filename = f"caiau_export_{project_name}_{project_id}.zip"
    zip_path = exports_dir / zip_filename
    
    try:
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # 1. Metadados do banco SQLite e Qdrant
            metadata_json = json.dumps(data, indent=2, ensure_ascii=False)
            zip_file.writestr("metadata.json", metadata_json)
            
            # 2. Proxies de vídeo
            if options.include_proxies:
                for v in data.get("videos", []):
                    proxy_name = f"proxy_vid_{v['id']}.mp4"
                    path = CONFIG.PROXIES_DIR / proxy_name
                    if path.exists():
                        zip_file.write(path, f"proxies/{proxy_name}")
                        
            # 3. Proxies de foto
            if options.include_photos:
                for p in data.get("photos", []):
                    proxy_photo_name = f"photo_{p['id']}.webp"
                    path = CONFIG.PROXIES_DIR / "photos" / proxy_photo_name
                    if path.exists():
                        zip_file.write(path, f"proxies/photos/{proxy_photo_name}")
                        
            # 4. Documentos de contexto originais
            if options.include_docs:
                for doc in data.get("production_docs", []):
                    if doc.get("filepath"):
                        doc_path = Path(doc["filepath"])
                        if doc_path.exists():
                            zip_file.write(doc_path, f"docs/{doc_path.name}")
                            
        return FileResponse(path=str(zip_path), filename=zip_filename, media_type="application/zip")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao exportar projeto: {str(e)}")

@router.post("/api/project/import")
async def import_project(file: UploadFile = File(...)):
    """Recebe um ZIP exportado e reconstrói o projeto, mídias e índices vetoriais."""
    temp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(temp_dir, "imported.zip")
    
    try:
        with open(zip_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
            
        metadata_path = os.path.join(temp_dir, "metadata.json")
        if not os.path.exists(metadata_path):
            raise HTTPException(status_code=400, detail="ZIP inválido: metadata.json ausente.")
            
        with open(metadata_path, "r", encoding="utf-8") as f:
            project_data = json.load(f)
            
        new_project_id = SyncService.import_project_all_data(project_data)
        
        # Copia proxies físicos de volta para a pasta de mídias se existirem no ZIP
        proxies_src_dir = os.path.join(temp_dir, "proxies")
        if os.path.exists(proxies_src_dir):
            CONFIG.PROXIES_DIR.mkdir(parents=True, exist_ok=True)
            for proxy_file in os.listdir(proxies_src_dir):
                src_file_path = os.path.join(proxies_src_dir, proxy_file)
                if os.path.isfile(src_file_path):
                    shutil.copy2(src_file_path, CONFIG.PROXIES_DIR / proxy_file)
                    
            # Proxies de fotos
            photos_src_dir = os.path.join(proxies_src_dir, "photos")
            if os.path.exists(photos_src_dir):
                photos_dest_dir = CONFIG.PROXIES_DIR / "photos"
                photos_dest_dir.mkdir(parents=True, exist_ok=True)
                for photo_file in os.listdir(photos_src_dir):
                    src_photo_path = os.path.join(photos_src_dir, photo_file)
                    if os.path.isfile(src_photo_path):
                        shutil.copy2(src_photo_path, photos_dest_dir / photo_file)
                        
        return {"status": "success", "project_id": new_project_id, "message": "Projeto importado com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao importar: {str(e)}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

@router.post("/api/project/{project_id}/docs")
async def upload_document(
    project_id: int, doc_type: str = "other", replace_doc_id: Optional[int] = None,
    file: UploadFile = File(...), conn: sqlite3.Connection = Depends(get_db_conn)
):
    """Faz upload de um documento de roteiro/pauta e indexa no Qdrant.

    Dedupe (P1.2): recusa com 409 se bytes ou conteúdo já existem no projeto; se o texto
    é muito parecido (mas não idêntico) a um doc existente, sugere substituição — o
    cliente reenvia com replace_doc_id para apagar a versão antiga (vetores + linha)
    antes de indexar a nova.
    """
    filename = file.filename
    file_bytes = await file.read()
    content = ""
    ext = Path(filename).suffix.lower()
    
    if ext in [".txt", ".fountain"]:
        try:
            content = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            content = file_bytes.decode("latin-1", errors="ignore")
    elif ext == ".fdx":
        try:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(file_bytes)
            paragraphs = []
            for p in root.findall(".//Paragraph"):
                text_elems = p.findall(".//Text")
                text = "".join([t.text for t in text_elems if t.text])
                ptype = p.attrib.get("Type", "")
                if text.strip():
                    paragraphs.append(f"{ptype.upper()}: {text.strip()}" if ptype else text.strip())
            content = "\n\n".join(paragraphs)
            if not content.strip():
                content = file_bytes.decode("utf-8", errors="ignore")
        except Exception:
            content = file_bytes.decode("utf-8", errors="ignore")
    elif ext == ".pdf":
        try:
            import pypdf
            from io import BytesIO
            reader = pypdf.PdfReader(BytesIO(file_bytes))
            pages_text = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    pages_text.append(text)
            content = "\n\n".join(pages_text)
        except ImportError:
            raise HTTPException(status_code=400, detail="Instale a biblioteca 'pypdf' para processar PDFs.")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Erro ao processar PDF: {str(e)}")
    else:
        raise HTTPException(status_code=400, detail="Formato não suportado. Use .txt, .fountain, .fdx ou .pdf.")

    if not content.strip():
        raise HTTPException(status_code=400, detail="O documento enviado está vazio.")

    byte_hash = ProjectRepository.hash_doc_bytes(file_bytes)
    content_hash = ProjectRepository.hash_doc_content(content)

    if replace_doc_id is not None:
        if not ProjectRepository.document_belongs_to_project(conn, project_id, replace_doc_id):
            raise HTTPException(status_code=404, detail=f"Documento {replace_doc_id} não encontrado neste projeto.")
        SemanticSearch.get_instance().delete_production_doc_vectors(project_id, replace_doc_id)
        ProjectRepository.delete_document(conn, replace_doc_id)
        conn.commit()
    else:
        existing_identical = ProjectRepository.find_document_by_byte_hash(conn, project_id, byte_hash)
        if existing_identical:
            raise HTTPException(status_code=409, detail={
                "reason": "identical",
                "existing_id": existing_identical["id"],
                "existing_filename": existing_identical["filename"],
                "message": f"Este arquivo já foi enviado (documento \"{existing_identical['filename']}\", id {existing_identical['id']}).",
            })

        existing_same_content = ProjectRepository.find_document_by_content_hash(conn, project_id, content_hash)
        if existing_same_content:
            raise HTTPException(status_code=409, detail={
                "reason": "same_content",
                "existing_id": existing_same_content["id"],
                "existing_filename": existing_same_content["filename"],
                "message": f"O mesmo conteúdo já está cadastrado em outro formato (documento \"{existing_same_content['filename']}\", id {existing_same_content['id']}).",
            })

        similarity_threshold = SettingsService.get_settings(project_id).get("docs.version_similarity_threshold")
        normalized_new = re.sub(r"\s+", " ", content.lower()).strip()
        best_match, best_ratio = None, 0.0
        for other in ProjectRepository.list_documents_for_similarity(conn, project_id):
            normalized_other = re.sub(r"\s+", " ", (other["content"] or "").lower()).strip()
            if not normalized_other:
                continue
            ratio = SequenceMatcher(None, normalized_new, normalized_other).quick_ratio()
            if ratio > best_ratio:
                best_match, best_ratio = other, ratio
        if best_match and best_ratio >= similarity_threshold:
            raise HTTPException(status_code=409, detail={
                "reason": "near_version",
                "existing_id": best_match["id"],
                "existing_filename": best_match["filename"],
                "similarity": round(best_ratio, 3),
                "message": f"Parece uma nova versão de \"{best_match['filename']}\" (id {best_match['id']}, {best_ratio*100:.0f}% parecido). Reenvie com replace_doc_id={best_match['id']} para substituir.",
            })

    try:
        doc_id = ProjectRepository.add_document(
            conn, project_id, filename, None, content, doc_type,
            byte_hash=byte_hash, content_hash=content_hash
        )
        conn.commit()

        # Indexa conteúdo no Qdrant
        search_engine = SemanticSearch.get_instance()
        search_engine.index_production_doc(project_id, doc_id, filename, content)

        return {"status": "success", "doc_id": doc_id, "filename": filename, "message": "Documento indexado com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/project/{project_id}/docs")
def list_documents(project_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna a lista de documentos de contexto cadastrados do projeto."""
    return ProjectRepository.list_documents(conn, project_id)

@router.delete("/api/docs/{doc_id}")
def remove_document(doc_id: int, project_id: int = Query(1), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Remove um documento de contexto e limpa seus vetores associados."""
    try:
        search_engine = SemanticSearch.get_instance()
        search_engine.delete_production_doc_vectors(project_id, doc_id)
        
        ProjectRepository.delete_document(conn, doc_id)
        conn.commit()
        return {"status": "success", "message": f"Documento ID {doc_id} removido."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/project/backup-db")
def backup_database():
    """Faz backup manual do arquivo de banco de dados SQLite para o S3."""
    from src.services.s3_service import S3Service
    s3_service = S3Service.get_instance()
    if not s3_service.enabled:
        raise HTTPException(status_code=400, detail="Serviço S3 não está ativo ou configurado no .env.")
    
    db_path = CONFIG.DB_PATH
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Banco de dados local não encontrado.")
    
    # Executar upload
    s3_key = "backups/capiau_backup.db"
    success = s3_service.upload_file(db_path, s3_key)
    if success:
        return {"status": "success", "message": "Backup do banco de dados concluído com sucesso para o S3.", "key": s3_key}
    else:
        raise HTTPException(status_code=500, detail="Falha ao fazer upload do backup para o S3. Verifique as travas de limite.")

@router.get("/api/project/{project_id}/speakers")
def get_project_speakers(project_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna lista consolidada de falantes e rostos rotulados do projeto."""
    from src.db.repositories.media import MediaRepository
    try:
        return MediaRepository.get_project_speakers_and_labeled_faces(conn, project_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
