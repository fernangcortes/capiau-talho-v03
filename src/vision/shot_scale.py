"""Escala de plano por zero-shot CLIP (E2.D1).

Compara o embedding CLIP de um quadro/foto contra descrições textuais de cada
escala de plano da gramática cinematográfica e devolve o rótulo mais próximo.
Roda 100% local (uma multiplicação de matriz por quadro) — custo de API zero.

Independente do Qdrant de propósito: carrega o próprio encoder de texto para
poder rodar em scripts offline e testes sem disputar o lock do modo local.
"""
from typing import Dict, List, Optional, Tuple

import numpy as np

# Rótulos fechados da taxonomia (valores ASCII estáveis para payload/filtros).
# Prompts em inglês: o CLIP foi treinado majoritariamente em inglês e o encoder
# multilíngue projeta para o mesmo espaço — inglês dá o zero-shot mais firme.
#
# ENSEMBLE por classe (validado em 20/07 sobre 60 fotos reais do acervo): com 1
# prompt por classe o CLIP decidia por SEMÂNTICA e não por ENQUADRAMENTO — cena
# de maquiagem virava 'close' (rosto é o assunto) e equipamento em plano aberto
# virava 'detalhe' (objeto é o assunto). As formulações extras ancoram esses
# casos na classe certa; o vetor da classe é o centróide normalizado do ensemble.
SHOT_SCALE_PROMPTS: Dict[str, List[str]] = {
    "detalhe": [
        "an extreme close-up photo of an object, macro photography",
        "a close-up photo of hands manipulating a small object, nothing else visible",
        "a small object filling the entire photo frame, shallow depth of field",
    ],
    "close": [
        "a close-up portrait of a person's face filling the frame",
        "a headshot photo showing only the face and shoulders of one person",
        "an extreme close-up of a human face, eyes and mouth prominent",
    ],
    "plano_medio": [
        "a medium shot of a person framed from the waist up",
        "a photo of people from the waist up talking indoors",
        "a medium shot of a makeup artist applying makeup to an actor",
        "a person working at a table, framed from the waist up",
    ],
    "plano_americano": [
        "a three-quarter shot of a person framed from the knees up",
        "a photo of a standing person cropped at the knees, american shot",
    ],
    "plano_geral": [
        "a wide shot of a whole room with several people small in the frame",
        "a wide establishing shot of a location",
        "a full shot of an environment, the entire scene visible from a distance",
        "a photo of film equipment set up in a large room, seen from far away",
    ],
    "aereo": [
        "an aerial photo taken from a drone high above the ground",
        "a top-down bird's eye view of the ground from high altitude",
    ],
}

SHOT_SCALE_LABELS: List[str] = list(SHOT_SCALE_PROMPTS.keys())

# Rótulos amigáveis para UI/log
SHOT_SCALE_UI_LABELS: Dict[str, str] = {
    "detalhe": "Detalhe",
    "close": "Close-up",
    "plano_medio": "Plano médio",
    "plano_americano": "Plano americano",
    "plano_geral": "Plano geral",
    "aereo": "Aéreo/Drone",
}

TEXT_MODEL = "sentence-transformers/clip-ViT-B-32-multilingual-v1"


class ShotScaleClassifier:
    """Singleton com os vetores dos rótulos pré-computados (uma vez por processo)."""

    _instance = None

    @classmethod
    def get_instance(cls) -> "ShotScaleClassifier":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._label_matrix: Optional[np.ndarray] = None  # (n_labels, 512) L2-normalizada

    def _ensure_labels(self) -> np.ndarray:
        if self._label_matrix is None:
            from sentence_transformers import SentenceTransformer
            print("[ShotScale] Carregando encoder de texto CLIP multilingue (uma vez)...")
            encoder = SentenceTransformer(TEXT_MODEL, device="cpu")
            rows = []
            for label in SHOT_SCALE_LABELS:
                vecs = np.asarray(encoder.encode(SHOT_SCALE_PROMPTS[label]), dtype=np.float32)
                vecs /= (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-12)
                centroid = vecs.mean(axis=0)
                centroid /= (np.linalg.norm(centroid) + 1e-12)
                rows.append(centroid)
            self._label_matrix = np.vstack(rows)
        return self._label_matrix

    def classify(self, image_vector: np.ndarray) -> Tuple[str, float]:
        """Rótulo de escala + similaridade cosseno do embedding CLIP de uma imagem."""
        labels = self._ensure_labels()
        v = np.asarray(image_vector, dtype=np.float32).reshape(-1)
        v /= (np.linalg.norm(v) + 1e-12)
        sims = labels @ v
        idx = int(np.argmax(sims))
        return SHOT_SCALE_LABELS[idx], float(sims[idx])

    def classify_batch(self, image_vectors: np.ndarray) -> List[Tuple[str, float]]:
        """Versão vetorizada para backfill: (N, 512) -> [(rotulo, score), ...]."""
        labels = self._ensure_labels()
        mat = np.asarray(image_vectors, dtype=np.float32)
        mat = mat / (np.linalg.norm(mat, axis=1, keepdims=True) + 1e-12)
        sims = mat @ labels.T  # (N, n_labels)
        idxs = np.argmax(sims, axis=1)
        return [(SHOT_SCALE_LABELS[int(i)], float(sims[n, int(i)])) for n, i in enumerate(idxs)]
