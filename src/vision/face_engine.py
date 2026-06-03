"""Motor de Detecção e Reconhecimento Facial (CPU Haar Cascades) do CaIAu Talho."""
import cv2
import json
from pathlib import Path
from src.db.operations import get_connection

def detect_faces_in_image(image_path: Path) -> list:
    """Detecta rostos usando Haar Cascades em uma imagem local (Pillow proxy ou original).
    Retorna uma lista de bounding boxes relativas: [[x, y, w, h], ...]
    """
    try:
        # OpenCV lê imagem física do disco
        img = cv2.imread(str(image_path))
        if img is None:
            return []
            
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        height, width = img.shape[:2]
        if height == 0 or width == 0:
            return []
            
        # Carrega o Haar Cascade frontal padrão da OpenCV
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        face_cascade = cv2.CascadeClassifier(cascade_path)
        
        if face_cascade.empty():
            print(f"[FACE_ENGINE] ❌ Erro: Não foi possível carregar o arquivo Haar Cascade em {cascade_path}")
            return []
            
        # Parâmetros otimizados para detecção de rostos leve em CPU
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(40, 40)
        )
        
        relative_faces = []
        for (x, y, w, h) in faces:
            rx = float(x) / width
            ry = float(y) / height
            rw = float(w) / width
            rh = float(h) / height
            # Salvar com 4 casas decimais para leveza
            relative_faces.append([round(rx, 4), round(ry, 4), round(rw, 4), round(rh, 4)])
            
        return relative_faces
    except Exception as e:
        print(f"[FACE_ENGINE] Erro na detecção de rostos para {image_path.name}: {e}")
        return []

def process_photo_faces(project_id: int, photo_id: int, image_path: Path):
    """Detecta rostos na foto de set e registra na tabela face do SQLite com name = NULL."""
    try:
        faces = detect_faces_in_image(image_path)
        if not faces:
            return
            
        conn = get_connection()
        try:
            cursor = conn.cursor()
            # Limpar detecções antigas da foto para evitar duplicações
            cursor.execute("DELETE FROM face WHERE photo_id = ?", (photo_id,))
            
            for rx, ry, rw, rh in faces:
                bounding_box_json = json.dumps([rx, ry, rw, rh])
                cursor.execute("""
                    INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp)
                    VALUES (?, NULL, ?, ?, NULL, NULL)
                """, (project_id, bounding_box_json, photo_id))
            conn.commit()
            print(f"[FACE_ENGINE] {len(faces)} rostos detectados e registrados para foto ID {photo_id}")
        finally:
            conn.close()
    except Exception as e:
        print(f"[FACE_ENGINE] Erro ao salvar rostos de foto ID {photo_id}: {e}")

def process_video_frame_faces(project_id: int, video_id: int, timestamp: float, image_path: Path):
    """Detecta rostos em um frame de B-roll extraído e registra na tabela face com name = NULL."""
    try:
        faces = detect_faces_in_image(image_path)
        if not faces:
            return
            
        conn = get_connection()
        try:
            cursor = conn.cursor()
            # Opcional: remover se houver uma detecção idêntica de timestamp
            cursor.execute("DELETE FROM face WHERE video_id = ? AND timestamp = ?", (video_id, timestamp))
            
            for rx, ry, rw, rh in faces:
                bounding_box_json = json.dumps([rx, ry, rw, rh])
                cursor.execute("""
                    INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp)
                    VALUES (?, NULL, ?, NULL, ?, ?)
                """, (project_id, bounding_box_json, video_id, timestamp))
            conn.commit()
            print(f"[FACE_ENGINE] {len(faces)} rostos detectados no frame {timestamp}s do vídeo ID {video_id}")
        finally:
            conn.close()
    except Exception as e:
        print(f"[FACE_ENGINE] Erro ao salvar rostos de frame do vídeo ID {video_id}: {e}")
