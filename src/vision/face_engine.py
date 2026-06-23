"""Motor de Detecção e Reconhecimento Facial (YuNet + SFace) do CapIAu-Talho."""
import cv2
import json
import numpy as np
import requests
from pathlib import Path
from src.db.connection import get_db

_detector = None
_recognizer = None

def download_face_models():
    """Baixa os modelos ONNX YuNet e SFace da OpenCV Zoo caso não existam localmente."""
    models_dir = Path("data/models")
    models_dir.mkdir(parents=True, exist_ok=True)
    
    yunet_path = models_dir / "face_detection_yunet_2023mar.onnx"
    sface_path = models_dir / "face_recognition_sface_2021dec.onnx"
    
    urls = {
        yunet_path: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        sface_path: "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
    }
    
    for path, url in urls.items():
        if not path.exists():
            print(f"[FACE_ENGINE] Baixando modelo {path.name} de {url}...")
            try:
                r = requests.get(url, stream=True, timeout=60)
                r.raise_for_status()
                with open(path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
                print(f"[FACE_ENGINE] Modelo {path.name} salvo com sucesso.")
            except Exception as e:
                print(f"[FACE_ENGINE] Erro crítico ao baixar {path.name}: {e}")
                raise e

def get_face_models():
    """Carrega dinamicamente os modelos YuNet e SFace na CPU (lazy loading)."""
    global _detector, _recognizer
    if _detector is None or _recognizer is None:
        download_face_models()
        models_dir = Path("data/models")
        yunet_path = models_dir / "face_detection_yunet_2023mar.onnx"
        sface_path = models_dir / "face_recognition_sface_2021dec.onnx"
        
        print("[FACE_ENGINE] Carregando detector YuNet e reconhecedor SFace na CPU...")
        _detector = cv2.FaceDetectorYN.create(
            model=str(yunet_path),
            config="",
            input_size=(320, 320),
            score_threshold=0.6,
            nms_threshold=0.3,
            top_k=5000,
            backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
            target_id=cv2.dnn.DNN_TARGET_CPU
        )
        
        _recognizer = cv2.FaceRecognizerSF.create(
            model=str(sface_path),
            config="",
            backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
            target_id=cv2.dnn.DNN_TARGET_CPU
        )
    return _detector, _recognizer

def is_blurry(crop_img, threshold=15.0) -> bool:
    """Calcula se a face recortada está desfocada usando a variância do operador Laplaciano."""
    if crop_img is None or crop_img.size == 0:
        return True
    try:
        gray = cv2.cvtColor(crop_img, cv2.COLOR_BGR2GRAY)
        variance = cv2.Laplacian(gray, cv2.CV_64F).var()
        return variance < threshold
    except Exception:
        return True

def detect_and_embed_faces(image_path: Path) -> list:
    """Detecta rostos via YuNet, alinha por landmarks e extrai embeddings via SFace.
    Aplica filtros de qualidade e de multidão adaptativos.
    Retorna uma lista de dicts: [{"box": [rx, ry, rw, rh], "embedding": [...]}, ...]
    """
    try:
        img = cv2.imread(str(image_path))
        if img is None:
            return []
            
        height, width = img.shape[:2]
        if height == 0 or width == 0:
            return []
            
        detector, recognizer = get_face_models()
        
        # Ajusta dinamicamente a resolução de entrada para o YuNet
        detector.setInputSize((width, height))
        
        # Detecta rostos
        retval, faces = detector.detect(img)
        if faces is None or len(faces) == 0:
            return []
            
        total_faces = len(faces)
        results = []
        
        for face in faces:
            # Coordenadas e landmarks do rosto detectado
            x, y, w, h = map(int, face[0:4])
            confidence = face[14]
            
            # Filtro de confiança padrão
            if confidence < 0.6:
                continue
                
            # Limites da bounding box
            x1, y1 = max(0, x), max(0, y)
            x2, y2 = min(width, x + w), min(height, y + h)
            if x2 <= x1 or y2 <= y1:
                continue
                
            crop_img = img[y1:y2, x1:x2]
            
            # Heurística de Multidões vs. Nitidez
            is_small = (w < 40 or h < 40)
            blurry = is_blurry(crop_img, threshold=15.0)
            
            # Rostos nítidos são sempre mantidos.
            # Rostos pequenos E borrados só são mantidos se houver poucos rostos no total (<= 8).
            # Se for uma cena com multidão (> 8 faces), descartamos os pequenos e borrados ao fundo.
            if is_small and blurry:
                if total_faces > 8:
                    continue
                    
            # Alinha a imagem facial antes do embedding
            try:
                aligned_face = recognizer.alignCrop(img, face)
                if aligned_face is None or aligned_face.size == 0:
                    continue
                    
                # Extrai vetor de embedding (128 floats)
                feat = recognizer.feature(aligned_face)
                if feat is None:
                    continue
                    
                # Normalização L2 para similaridade por produto escalar
                norm = np.linalg.norm(feat)
                if norm > 0:
                    feat = feat / norm
                embedding_list = feat.flatten().tolist()
            except Exception as fe:
                print(f"[FACE_ENGINE] Erro no processamento de embedding: {fe}")
                continue
                
            # Converter coordenadas para relativas
            rx = float(x) / width
            ry = float(y) / height
            rw = float(w) / width
            rh = float(h) / height
            
            results.append({
                "box": [round(rx, 4), round(ry, 4), round(rw, 4), round(rh, 4)],
                "embedding": embedding_list
            })
            
        return results
    except Exception as e:
        print(f"[FACE_ENGINE] Erro crítico ao detectar/gerar embeddings em {image_path.name}: {e}")
        return []

def detect_faces_in_image(image_path: Path) -> list:
    """Função legada para compatibilidade externa. Retorna apenas bounding boxes relativas."""
    results = detect_and_embed_faces(image_path)
    return [r["box"] for r in results]

def process_photo_faces(project_id: int, photo_id: int, image_path: Path) -> None:
    """Detecta rostos na foto de set, extrai embeddings e salva no SQLite."""
    try:
        results = detect_and_embed_faces(image_path)
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM face WHERE photo_id = ?", (photo_id,))
            
            for res in results:
                rx, ry, rw, rh = res["box"]
                bounding_box_json = json.dumps([rx, ry, rw, rh])
                embedding_json = json.dumps(res["embedding"])
                cursor.execute("""
                    INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp, embedding)
                    VALUES (?, NULL, ?, ?, NULL, NULL, ?)
                """, (project_id, bounding_box_json, photo_id, embedding_json))
            conn.commit()
            if results:
                print(f"[FACE_ENGINE] {len(results)} rostos indexados na foto ID {photo_id}")
    except Exception as e:
        print(f"[FACE_ENGINE] Erro ao salvar rostos da foto ID {photo_id}: {e}")

def process_video_frame_faces(project_id: int, video_id: int, timestamp: float, image_path: Path) -> None:
    """Detecta rostos em um frame de B-roll, extrai embeddings e registra no SQLite."""
    try:
        results = detect_and_embed_faces(image_path)
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM face WHERE video_id = ? AND timestamp = ?", (video_id, timestamp))
            
            for res in results:
                rx, ry, rw, rh = res["box"]
                bounding_box_json = json.dumps([rx, ry, rw, rh])
                embedding_json = json.dumps(res["embedding"])
                cursor.execute("""
                    INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp, embedding)
                    VALUES (?, NULL, ?, NULL, ?, ?, ?)
                """, (project_id, bounding_box_json, video_id, timestamp, embedding_json))
            conn.commit()
            if results:
                print(f"[FACE_ENGINE] {len(results)} rostos indexados no frame {timestamp}s do vídeo ID {video_id}")
    except Exception as e:
        print(f"[FACE_ENGINE] Erro ao salvar rostos do frame {timestamp}s do vídeo ID {video_id}: {e}")

def dbscan_numpy(distances, eps, min_samples):
    """Implementação puramente matricial do DBSCAN usando NumPy (ideal para CPU).
    Retorna uma lista de labels onde -1 representa ruído.
    """
    n = distances.shape[0]
    labels = -np.ones(n, dtype=int)
    cluster_id = 0
    
    # Precalcula os vizinhos de cada ponto com distância <= eps
    neighbors_list = [np.where(distances[i] <= eps)[0] for i in range(n)]
    
    for i in range(n):
        if labels[i] != -1: # Já classificado
            continue
            
        neighbors = neighbors_list[i]
        if len(neighbors) < min_samples:
            continue
            
        # Ponto central inicial
        labels[i] = cluster_id
        
        # Fila de expansão de vizinhos
        queue = list(neighbors)
        in_queue = set(neighbors)
        idx = 0
        while idx < len(queue):
            curr_point = queue[idx]
            idx += 1
            
            # Se era ruído, adiciona ao cluster
            if labels[curr_point] == -1:
                labels[curr_point] = cluster_id
            elif labels[curr_point] >= 0:
                continue
                
            labels[curr_point] = cluster_id
            
            curr_neighbors = neighbors_list[curr_point]
            if len(curr_neighbors) >= min_samples:
                for nb in curr_neighbors:
                    if nb not in in_queue:
                        in_queue.add(nb)
                        queue.append(nb)
                        
        cluster_id += 1
        
    return labels

def cluster_faces_dbscan(project_id: int, eps: float = 0.38, min_samples: int = 3) -> dict:
    """Carrega embeddings do SQLite, agrupa via DBSCAN (similaridade cosseno NumPy) e salva os clusters."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            # Obter todas as faces do projeto que possuem embedding
            cursor.execute("""
                SELECT id, name, embedding FROM face 
                WHERE project_id = ? AND embedding IS NOT NULL
            """, (project_id,))
            rows = cursor.fetchall()
            
            if not rows:
                return {"total_faces": 0, "clustered_faces": 0, "clusters_created": 0, "noise_faces": 0}
                
            face_ids = []
            embeddings = []
            existing_names = {} # Mapeia face_id para name
            
            for row in rows:
                emb = json.loads(row["embedding"])
                if len(emb) == 128:
                    face_ids.append(row["id"])
                    embeddings.append(emb)
                    if row["name"]:
                        existing_names[row["id"]] = row["name"]
                        
            if not embeddings:
                return {"total_faces": 0, "clustered_faces": 0, "clusters_created": 0, "noise_faces": 0}
                
            embeddings = np.array(embeddings, dtype=np.float32)
            
            # Similaridade Cosseno = Produto Escalar das matrizes normalizadas L2
            similarities = np.dot(embeddings, embeddings.T)
            distances = 1.0 - np.clip(similarities, -1.0, 1.0)
            
            # Rodar DBSCAN
            labels = dbscan_numpy(distances, eps, min_samples)
            
            # Mapear faces por cluster_id
            clusters_map = {}
            for idx, label in enumerate(labels):
                lbl = int(label)
                if lbl >= 0:
                    if lbl not in clusters_map:
                        clusters_map[lbl] = []
                    clusters_map[lbl].append(face_ids[idx])
                    
            # Para cada cluster, verificar se já existe algum rosto nomeado pelo usuário
            for cluster_id, f_ids in clusters_map.items():
                cluster_name = None
                for fid in f_ids:
                    if fid in existing_names:
                        cluster_name = existing_names[fid]
                        break
                        
                # Se não há nome existente, definir nome provisório
                if not cluster_name:
                    cluster_name = f"Pessoa Desconhecida (Grupo {cluster_id + 1})"
                    
                # Atualizar faces do cluster
                placeholders = ",".join("?" for _ in f_ids)
                cursor.execute(f"""
                    UPDATE face 
                    SET cluster_id = ?, name = ? 
                    WHERE id IN ({placeholders})
                """, [cluster_id, cluster_name] + f_ids)
                
            # Tratar ruído: cluster_id = -1
            noise_ids = [face_ids[idx] for idx, label in enumerate(labels) if int(label) == -1]
            if noise_ids:
                placeholders = ",".join("?" for _ in noise_ids)
                cursor.execute(f"""
                    UPDATE face 
                    SET cluster_id = -1 
                    WHERE id IN ({placeholders})
                """, noise_ids)
                
            conn.commit()
            
            total = len(face_ids)
            clustered = sum(len(ids) for ids in clusters_map.values())
            k_clusters = len(clusters_map)
            noise = len(noise_ids)
            
            print(f"[FACE_ENGINE] Clustering concluído: {total} faces, {clustered} agrupadas em {k_clusters} clusters, {noise} ruídos.")
            return {
                "total_faces": total,
                "clustered_faces": clustered,
                "clusters_created": k_clusters,
                "noise_faces": noise
            }
    except Exception as e:
        print(f"[FACE_ENGINE] Erro no clustering: {e}")
        return {"total_faces": 0, "clustered_faces": 0, "clusters_created": 0, "noise_faces": 0, "error": str(e)}

def merge_clusters(project_id: int, cluster_src: int, cluster_dest: int, name: str) -> None:
    """Mescla duas IDs de cluster e atualiza o nome de todas as faces sob o mesmo destino."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE face 
                SET cluster_id = ?, name = ? 
                WHERE project_id = ? AND cluster_id = ?
            """, (cluster_dest, name, project_id, cluster_src))
            conn.commit()
            print(f"[FACE_ENGINE] Cluster {cluster_src} mesclado com Cluster {cluster_dest} sob o nome '{name}'")
    except Exception as e:
        print(f"[FACE_ENGINE] Erro ao mesclar clusters: {e}")
        raise e

def reassign_faces(project_id: int, face_ids: list, target_cluster_id: int, target_name: str) -> None:
    """Reatribui uma lista de faces para um cluster_id e nome específicos (Desambiguação Unitária)."""
    try:
        if not face_ids:
            return
        with get_db() as conn:
            cursor = conn.cursor()
            placeholders = ",".join("?" for _ in face_ids)
            cursor.execute(f"""
                UPDATE face 
                SET cluster_id = ?, name = ? 
                WHERE project_id = ? AND id IN ({placeholders})
            """, [target_cluster_id, target_name, project_id] + face_ids)
            conn.commit()
            print(f"[FACE_ENGINE] {len(face_ids)} faces reatribuídas para o cluster {target_cluster_id} ('{target_name}')")
    except Exception as e:
        print(f"[FACE_ENGINE] Erro ao reatribuir faces: {e}")
        raise e

