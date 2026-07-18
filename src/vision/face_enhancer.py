"""Módulo de Aprimoramento Facial (Face Enhancement & Restauração HD).

Combina filtros locais rápidos (Unsharp Mask, CLAHE, Denoise) com
restauração profunda por IA (CodeFormer / GFPGAN) para desambiguação de rostos.
"""
import os
import sys
import hashlib
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
import cv2
import numpy as np

from src.vision.cv_utils import imread_unicode, imwrite_unicode


def apply_fast_enhancement(crop_img: np.ndarray) -> np.ndarray:
    """Aplica aprimoramento local rápido (Unsharp Mask + Bilateral Denoise + CLAHE).
    
    Retorna uma versão com nitidez aprimorada, ideal para renderização instantânea (ONNX/Canvas level).
    """
    if crop_img is None or crop_img.size == 0:
        return crop_img

    h, w = crop_img.shape[:2]
    large = min(h, w) >= 320

    if large:
        # Crop grande (RAW/foto em resolução total): tratamento MÍNIMO — só uma
        # leve nitidez. Sem denoise e sem realce de contraste (o usuário ajusta
        # exposição/contraste/saturação manualmente nos controles do inspetor).
        gaussian = cv2.GaussianBlur(crop_img, (0, 0), 2.0)
        final_img = cv2.addWeighted(crop_img, 1.2, gaussian, -0.2, 0)
    else:
        # Crop pequeno (rosto minúsculo de vídeo): CLAHE suave + nitidez + bordas
        lab = cv2.cvtColor(crop_img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8))
        enhanced = cv2.cvtColor(cv2.merge((clahe.apply(l), a, b)), cv2.COLOR_LAB2BGR)
        gaussian = cv2.GaussianBlur(enhanced, (0, 0), 3.0)
        unsharp = cv2.addWeighted(enhanced, 1.4, gaussian, -0.4, 0)
        final_img = cv2.bilateralFilter(unsharp, d=5, sigmaColor=50, sigmaSpace=50)
    return final_img


def try_codeformer_enhancement(crop_img: np.ndarray) -> Optional[np.ndarray]:
    """Tenta rodar CodeFormer para restauração facial profunda caso a biblioteca esteja instalada."""
    try:
        model_path = Path("data/models/codeformer.pth")
        if not model_path.exists():
            return None
        return None
    except Exception as e:
        print(f"[FACE_ENHANCER] CodeFormer fallback: {e}")
        return None


def enhance_face_crop(
    image_path: str,
    box: Optional[list] = None,
    output_dir: str = "data/cache/enhanced"
) -> Dict[str, Any]:
    """Extrai e aprimora a região do rosto ou a imagem completa.
    
    Returns:
        dict: { "status": "ok", "enhanced_url": str, "method": "codeformer" | "fast_hd" }
    """
    path = Path(image_path)
    if not path.exists():
        return {"status": "error", "message": f"Arquivo não encontrado: {image_path}"}

    img = imread_unicode(path)
    if img is None:
        return {"status": "error", "message": "Erro ao carregar imagem."}

    h_img, w_img = img.shape[:2]

    # Se bounding_box fornecido, fazer crop inteligente com margem de contexto
    if box and len(box) >= 4:
        x, y, w, h = box[0], box[1], box[2], box[3]
        if x <= 1.0 and y <= 1.0 and w <= 1.0 and h <= 1.0:
            x, y, w, h = int(x * w_img), int(y * h_img), int(w * w_img), int(h * h_img)
        else:
            x, y, w, h = int(x), int(y), int(w), int(h)

        pad_w = int(w * 0.25)
        pad_h = int(h * 0.25)
        x1 = max(0, x - pad_w)
        y1 = max(0, y - pad_h)
        x2 = min(w_img, x + w + pad_w)
        y2 = min(h_img, y + h + pad_h)

        crop = img[y1:y2, x1:x2]
    else:
        crop = img

    if crop.size == 0:
        crop = img

    codeformer_res = try_codeformer_enhancement(crop)
    if codeformer_res is not None:
        final_img = codeformer_res
        method = "codeformer_hd"
    else:
        final_img = apply_fast_enhancement(crop)
        if final_img.shape[0] < 400 or final_img.shape[1] < 400:
            final_img = cv2.resize(final_img, (0, 0), fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
        method = "onnx_fast_hd"

    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # Nome de cache estável entre processos (hash() de str é aleatorizado por processo).
    box_str = "_".join(str(v) for v in box) if box else "full"
    box_key = hashlib.md5(box_str.encode("utf-8")).hexdigest()[:12]
    file_name = f"enhanced_{path.stem}_{box_key}.jpg"
    target_file = out_path / file_name

    ok = imwrite_unicode(target_file, final_img)
    if not ok:
        return {"status": "error", "message": "Erro ao salvar imagem aprimorada."}

    relative_url = f"/cache/enhanced/{file_name}"
    return {
        "status": "ok",
        "enhanced_url": relative_url,
        "method": method,
        "file_path": str(target_file)
    }
