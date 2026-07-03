"""Teste de integração para motor de rostos, DBSCAN e API de faces."""
import sys
from pathlib import Path
# Garante que a raiz do projeto esteja no sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import unittest
import json
import numpy as np
from fastapi.testclient import TestClient
from src.config import CONFIG

from src.db.schema import init_db
from src.db.connection import get_db
from src.vision.face_engine import dbscan_numpy
from src.api.server import app

class TestFaceRecognitionAndClustering(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Pasta temporária para a execução do teste
        cls.test_dir = Path(__file__).resolve().parent.parent / "data_test_face"
        cls.test_dir.mkdir(exist_ok=True)
        
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_face.db"
        
        init_db(CONFIG.DB_PATH)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        import shutil
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_dbscan_numpy(self):
        """Valida o funcionamento matemático do DBSCAN local em NumPy."""
        # 3 pontos no cluster A, 3 pontos no cluster B, 1 outlier
        # Vetores unitários de 128 dimensões
        p1 = np.zeros(128)
        p1[0] = 1.0
        
        p2 = np.zeros(128)
        p2[0] = 0.99
        p2[1] = 0.1
        p2 = p2 / np.linalg.norm(p2)
        
        p3 = np.zeros(128)
        p3[0] = 0.98
        p3[1] = -0.15
        p3 = p3 / np.linalg.norm(p3)
        
        p4 = np.zeros(128)
        p4[10] = 1.0
        
        p5 = np.zeros(128)
        p5[10] = 0.99
        p5[11] = 0.05
        p5 = p5 / np.linalg.norm(p5)
        
        p6 = np.zeros(128)
        p6[10] = 0.97
        p6[11] = -0.1
        p6 = p6 / np.linalg.norm(p6)
        
        # Outlier
        p7 = np.zeros(128)
        p7[50] = 1.0
        
        embeddings = np.array([p1, p2, p3, p4, p5, p6, p7], dtype=np.float32)
        
        similarities = np.dot(embeddings, embeddings.T)
        distances = 1.0 - np.clip(similarities, -1.0, 1.0)
        
        # Epsilon = 0.38, MinPts = 3
        labels = dbscan_numpy(distances, eps=0.38, min_samples=3)
        
        self.assertEqual(labels[0], labels[1])
        self.assertEqual(labels[0], labels[2])
        self.assertEqual(labels[3], labels[4])
        self.assertEqual(labels[3], labels[5])
        self.assertNotEqual(labels[0], labels[3])
        self.assertEqual(labels[6], -1) # Ruído

    def test_face_endpoints_and_clustering(self):
        """Insere faces simuladas no SQLite, executa clustering e resolve conflitos de rotulagem."""
        project_id = 1
        
        # Gerar embeddings simulados (L2 normalizados)
        emb_maria = [1.0] + [0.0]*127
        emb_joao = [0.0]*10 + [1.0] + [0.0]*117
        emb_noise = [0.0]*50 + [1.0] + [0.0]*77
        
        # Inserir faces no SQLite
        with get_db() as conn:
            cursor = conn.cursor()
            # Garante que o projeto e fotos existem para satisfazer chaves estrangeiras
            cursor.execute("INSERT OR IGNORE INTO project (id, name, description) VALUES (?, ?, ?)", (project_id, "Project Teste", "Desc"))
            for p_id in [10, 11, 12, 20, 21, 22, 30, 99]:
                cursor.execute("""
                    INSERT OR IGNORE INTO photo (id, project_id, filename, filepath, hash, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (p_id, project_id, f"test_photo_{p_id}.jpg", f"/dummy/path_{p_id}.jpg", f"hash_{p_id}", 'ingested'))

            
            cursor.execute("DELETE FROM face WHERE project_id = ?", (project_id,))

            
            # 3 faces próximas ao padrão Maria
            for i in range(3):
                offset = (i - 1) * 0.02
                emb = [1.0 - abs(offset)] + [offset] + [0.0]*126
                norm = np.linalg.norm(emb)
                emb = (np.array(emb) / norm).tolist()
                cursor.execute("""
                    INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp)
                    VALUES (?, ?, ?, ?, NULL, NULL)
                """, (project_id, None, json.dumps([0.1, 0.1, 0.2, 0.2]), 10 + i))
                face_id = cursor.lastrowid
                cursor.execute("""
                    INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence, status)
                    VALUES (?, 0, 'yunet_sface', 'v1.0', ?, 0.8, 'auto')
                """, (face_id, json.dumps(emb)))
                
            # 3 faces próximas ao padrão João
            for i in range(3):
                offset = (i - 1) * 0.02
                emb = [0.0]*10 + [1.0 - abs(offset)] + [offset] + [0.0]*116
                norm = np.linalg.norm(emb)
                emb = (np.array(emb) / norm).tolist()
                cursor.execute("""
                    INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp)
                    VALUES (?, ?, ?, ?, NULL, NULL)
                """, (project_id, None, json.dumps([0.4, 0.4, 0.2, 0.2]), 20 + i))
                face_id = cursor.lastrowid
                cursor.execute("""
                    INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence, status)
                    VALUES (?, 0, 'yunet_sface', 'v1.0', ?, 0.8, 'auto')
                """, (face_id, json.dumps(emb)))
                
            # 1 face ruído
            cursor.execute("""
                INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp)
                VALUES (?, ?, ?, ?, NULL, NULL)
            """, (project_id, None, json.dumps([0.8, 0.8, 0.1, 0.1]), 99))
            face_id = cursor.lastrowid
            cursor.execute("""
                INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence, status)
                VALUES (?, 0, 'yunet_sface', 'v1.0', ?, 0.8, 'auto')
            """, (face_id, json.dumps(emb_noise)))
            
            conn.commit()

        # 1. Trigger Clustering
        response = self.client.post(f"/api/faces/project/{project_id}/faces/cluster?eps=0.38&min_samples=3")
        self.assertEqual(response.status_code, 200)
        c_res = response.json()
        self.assertEqual(c_res["total_faces"], 7)
        self.assertEqual(c_res["clustered_faces"], 6)
        self.assertEqual(c_res["clusters_created"], 2)
        self.assertEqual(c_res["noise_faces"], 1)

        # 2. List Clusters
        response = self.client.get(f"/api/faces/project/{project_id}/face-clusters")
        self.assertEqual(response.status_code, 200)
        clusters = response.json()
        self.assertEqual(len(clusters), 2)
        
        # Mapeamento dos clusters criados
        cluster_a = clusters[0] # Maior ocorrência (ambos têm 3, ordem depende do SQLite)
        cluster_b = clusters[1]
        
        # 3. Label Cluster A as "Maria"
        response = self.client.post(f"/api/faces/face/{cluster_a['rep_face_id']}/label", json={"name": "Maria"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Maria", response.json()["message"])
        
        # Verificar se as outras faces do cluster A herdaram o nome
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) as count FROM face WHERE name = ? AND cluster_id = ?", ("Maria", cluster_a["cluster_id"]))
            self.assertEqual(cursor.fetchone()["count"], 3)

        # 4. Label Cluster B as "Maria" -> Deverá acusar CONFLITO
        response = self.client.post(f"/api/faces/face/{cluster_b['rep_face_id']}/label", json={"name": "Maria"})
        self.assertEqual(response.status_code, 200)
        label_res = response.json()
        self.assertEqual(label_res["status"], "conflict")
        self.assertEqual(label_res["target_name"], "Maria")
        self.assertEqual(label_res["current_cluster_id"], cluster_b["cluster_id"])
        self.assertEqual(label_res["existing_cluster_id"], cluster_a["cluster_id"])

        # 5. Resolver conflito por Fusão Total (Merge)
        response = self.client.post(f"/api/faces/project/{project_id}/faces/merge", json={
            "src_cluster_id": cluster_b["cluster_id"],
            "dest_cluster_id": cluster_a["cluster_id"],
            "name": "Maria"
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "success")

        # Verificar se todos os 6 rostos foram agrupados no cluster_a sob o nome "Maria"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) as count FROM face WHERE name = ? AND cluster_id = ?", ("Maria", cluster_a["cluster_id"]))
            self.assertEqual(cursor.fetchone()["count"], 6)

        # 6. Adicionar uma nova face ao Cluster C (simulado)
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp)
                VALUES (?, ?, ?, 30, NULL, NULL)
            """, (project_id, "Maria", json.dumps([0.1, 0.1, 0.2, 0.2])))
            new_face_id = cursor.lastrowid
            cursor.execute("""
                INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence, status)
                VALUES (?, 0, 'yunet_sface', 'v1.0', ?, 0.8, 'auto')
            """, (new_face_id, json.dumps(emb_maria)))
            # Atribuir manualmente a um novo cluster_id = 9
            cursor.execute("UPDATE face SET cluster_id = 9 WHERE id = ?", (new_face_id,))
            conn.commit()

        # Reatribuir individualmente (Desambiguação Manual Unitária)
        response = self.client.post(f"/api/faces/project/{project_id}/faces/reassign", json={
            "face_ids": [new_face_id],
            "target_cluster_id": cluster_a["cluster_id"],
            "target_name": "Maria Real"
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "success")

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name, cluster_id FROM face WHERE id = ?", (new_face_id,))
            row = cursor.fetchone()
            self.assertEqual(row["name"], "Maria Real")
            self.assertEqual(row["cluster_id"], cluster_a["cluster_id"])

        # Testar desambiguação fullscreen: listar rostos não rotulados
        response = self.client.get(f"/api/faces/project/{project_id}/unlabeled-faces")
        self.assertEqual(response.status_code, 200)
        unlabeled_list = response.json()
        self.assertTrue(len(unlabeled_list) > 0)
        
        # Testar cruzamento e enriquecimento de descrição visual
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE photo SET description = ? WHERE id = 30", ("Um homem de casaco deitado na grama.",))
            conn.commit()
            
        response = self.client.get(f"/api/search?query=Maria%20Real&project_id={project_id}")
        self.assertEqual(response.status_code, 200)
        search_data = response.json()
        search_res = search_data.get("results", [])
        self.assertTrue(len(search_res) > 0)
        first_text = search_res[0]["payload"]["text"]
        self.assertIn("Maria Real de casaco deitado na grama.", first_text)

        # 7. Testar rejeição com especificação de objeto
        response = self.client.post(f"/api/faces/face/{new_face_id}/reject", json={"name": "Luminária"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "success")

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM face WHERE id = ?", (new_face_id,))
            self.assertEqual(cursor.fetchone()["name"], "Luminária")
            cursor.execute("SELECT status FROM face_recognition WHERE face_id = ? ORDER BY recognized_at DESC, id DESC LIMIT 1", (new_face_id,))
            self.assertEqual(cursor.fetchone()["status"], "rejected")

        # 8. Testar rejeição sem payload (fallback para 'Não Relevante')
        response = self.client.post(f"/api/faces/face/{new_face_id}/reject")
        self.assertEqual(response.status_code, 200)

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM face WHERE id = ?", (new_face_id,))
            self.assertEqual(cursor.fetchone()["name"], "Não Relevante")


if __name__ == "__main__":
    unittest.main()
