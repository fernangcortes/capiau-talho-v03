"""src/vision/spatial_grounding.py — Padronização Canônica Gemini e Conversões Espaciais 2026.

Unifica coordenadas de bounding boxes no padrão inteiro canônico Gemini [ymin, xmin, ymax, xmax] (0 a 1000),
fornecendo conversões bidirecionais transparentes para detectores locais (YOLO-World v2, Florence-2, DINO-X)
e funções de validação, cálculo de IoU e formatação de payloads para SQLite e Qdrant.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union


def validate_gemini_box(box: Any) -> bool:
    """Valida se o objeto cumpre estritamente o contrato canônico Gemini [ymin, xmin, ymax, xmax].
    
    Regras:
    1. Deve ser lista ou tupla com exatamente 4 elementos.
    2. Todos os elementos devem ser inteiros (isinstance(v, int) e not isinstance(v, bool)).
    3. Todos os valores devem estar no intervalo discreto [0, 1000].
    4. ymin <= ymax e xmin <= xmax.
    """
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return False
    for v in box:
        if isinstance(v, bool) or not isinstance(v, int):
            return False
        if not (0 <= v <= 1000):
            return False
    ymin, xmin, ymax, xmax = box
    if ymin > ymax or xmin > xmax:
        return False
    return True


def clamp_gemini_box(box: Sequence[Union[int, float]]) -> List[int]:
    """Converte e ajusta uma sequência de 4 números para um box canônico Gemini válido [ymin, xmin, ymax, xmax]."""
    if len(box) != 4:
        raise ValueError(f"Bounding box deve conter exatamente 4 valores, recebido: {box}")
    
    vals = [max(0, min(1000, int(round(float(v))))) for v in box]
    ymin, xmin, ymax, xmax = vals
    if ymin > ymax:
        ymin, ymax = ymax, ymin
    if xmin > xmax:
        xmin, xmax = xmax, xmin
    return [ymin, xmin, ymax, xmax]


def yolo_center_to_gemini_box(cx: float, cy: float, w: float, h: float) -> List[int]:
    """Converte formato padrão YOLO [cx, cy, w, h] (centro normalizado 0.0-1.0) para Gemini [ymin, xmin, ymax, xmax] (0-1000)."""
    cx = float(cx)
    cy = float(cy)
    w = float(w)
    h = float(h)
    
    xmin = round((cx - w / 2.0) * 1000.0)
    xmax = round((cx + w / 2.0) * 1000.0)
    ymin = round((cy - h / 2.0) * 1000.0)
    ymax = round((cy + h / 2.0) * 1000.0)
    
    return clamp_gemini_box([ymin, xmin, ymax, xmax])


def gemini_to_yolo_center_box(box: Sequence[int]) -> List[float]:
    """Converte formato canônico Gemini [ymin, xmin, ymax, xmax] para YOLO [cx, cy, w, h] (0.0-1.0)."""
    ymin, xmin, ymax, xmax = box
    w = max(0.0, (xmax - xmin) / 1000.0)
    h = max(0.0, (ymax - ymin) / 1000.0)
    cx = (xmin / 1000.0) + (w / 2.0)
    cy = (ymin / 1000.0) + (h / 2.0)
    return [round(cx, 4), round(cy, 4), round(w, 4), round(h, 4)]


def yolo_to_gemini_box(rx: float, ry: float, rw: float, rh: float, is_center: bool = False) -> List[int]:
    """Converte bounding box YOLO relativo para formato canônico Gemini [ymin, xmin, ymax, xmax] (0 a 1000).
    
    Se is_center for True, rx e ry são interpretados como o centro (cx, cy).
    Caso contrário, são interpretados como o canto superior esquerdo (top-left).
    """
    if is_center:
        return yolo_center_to_gemini_box(rx, ry, rw, rh)
    
    xmin = max(0, min(1000, round(float(rx) * 1000.0)))
    ymin = max(0, min(1000, round(float(ry) * 1000.0)))
    xmax = max(0, min(1000, round((float(rx) + float(rw)) * 1000.0)))
    ymax = max(0, min(1000, round((float(ry) + float(rh)) * 1000.0)))
    return [ymin, xmin, ymax, xmax]


def gemini_to_yolo_box(box: Sequence[int], as_center: bool = False) -> List[float]:
    """Converte formato canônico Gemini [ymin, xmin, ymax, xmax] para YOLO relativo (0.0 a 1.0).
    
    Se as_center for True, retorna [cx, cy, w, h]. Caso contrário, retorna [rx, ry, rw, rh] (top-left).
    """
    if as_center:
        return gemini_to_yolo_center_box(box)
    
    ymin, xmin, ymax, xmax = box
    rx = round(xmin / 1000.0, 4)
    ry = round(ymin / 1000.0, 4)
    rw = round(max(0.0, (xmax - xmin) / 1000.0), 4)
    rh = round(max(0.0, (ymax - ymin) / 1000.0), 4)
    return [rx, ry, rw, rh]


def dinox_to_gemini_box(x1: float, y1: float, x2: float, y2: float) -> List[int]:
    """Converte bounding box DINO-X/Florence-2 relativo [x1, y1, x2, y2] (0.0-1.0) para [ymin, xmin, ymax, xmax] (0-1000)."""
    xmin = max(0, min(1000, round(float(x1) * 1000.0)))
    ymin = max(0, min(1000, round(float(y1) * 1000.0)))
    xmax = max(0, min(1000, round(float(x2) * 1000.0)))
    ymax = max(0, min(1000, round(float(y2) * 1000.0)))
    return [ymin, xmin, ymax, xmax]


def gemini_to_dinox_box(box: Sequence[int]) -> List[float]:
    """Converte formato canônico Gemini [ymin, xmin, ymax, xmax] para DINO-X [x1, y1, x2, y2] (0.0 a 1.0)."""
    ymin, xmin, ymax, xmax = box
    return [
        round(xmin / 1000.0, 4),
        round(ymin / 1000.0, 4),
        round(xmax / 1000.0, 4),
        round(ymax / 1000.0, 4),
    ]


def pixel_to_gemini_box(
    px_box: Sequence[Union[int, float]],
    img_width: int,
    img_height: int,
    order: str = "ymin_xmin_ymax_xmax",
) -> List[int]:
    """Converte coordenadas em pixels absolutos para a escala canônica Gemini 0–1000.
    
    order suportados:
    - 'ymin_xmin_ymax_xmax': [ymin_px, xmin_px, ymax_px, xmax_px]
    - 'xmin_ymin_xmax_ymax': [x1_px, y1_px, x2_px, y2_px]
    - 'xywh': [x_px, y_px, w_px, h_px] (top-left)
    """
    if img_width <= 0 or img_height <= 0:
        raise ValueError(f"Dimensões da imagem inválidas: width={img_width}, height={img_height}")
    if len(px_box) != 4:
        raise ValueError(f"px_box deve conter 4 elementos, recebido: {px_box}")
        
    v0, v1, v2, v3 = px_box
    if order == "ymin_xmin_ymax_xmax":
        ymin_px, xmin_px, ymax_px, xmax_px = v0, v1, v2, v3
    elif order == "xmin_ymin_xmax_ymax":
        xmin_px, ymin_px, xmax_px, ymax_px = v0, v1, v2, v3
    elif order == "xywh":
        xmin_px, ymin_px, xmax_px, ymax_px = v0, v1, v0 + v2, v1 + v3
    else:
        raise ValueError(f"Ordem de coordenadas não suportada: '{order}'")
        
    ymin = round((float(ymin_px) / img_height) * 1000.0)
    xmin = round((float(xmin_px) / img_width) * 1000.0)
    ymax = round((float(ymax_px) / img_height) * 1000.0)
    xmax = round((float(xmax_px) / img_width) * 1000.0)
    
    return clamp_gemini_box([ymin, xmin, ymax, xmax])


def gemini_to_pixel_box(
    box: Sequence[int],
    img_width: int,
    img_height: int,
    order: str = "ymin_xmin_ymax_xmax",
) -> List[int]:
    """Converte formato canônico Gemini [ymin, xmin, ymax, xmax] para pixels absolutos da imagem."""
    if img_width <= 0 or img_height <= 0:
        raise ValueError(f"Dimensões da imagem inválidas: width={img_width}, height={img_height}")
        
    ymin, xmin, ymax, xmax = box
    ymin_px = max(0, min(img_height, round((ymin / 1000.0) * img_height)))
    xmin_px = max(0, min(img_width, round((xmin / 1000.0) * img_width)))
    ymax_px = max(0, min(img_height, round((ymax / 1000.0) * img_height)))
    xmax_px = max(0, min(img_width, round((xmax / 1000.0) * img_width)))
    
    if order == "ymin_xmin_ymax_xmax":
        return [ymin_px, xmin_px, ymax_px, xmax_px]
    elif order == "xmin_ymin_xmax_ymax":
        return [xmin_px, ymin_px, xmax_px, ymax_px]
    elif order == "xywh":
        return [xmin_px, ymin_px, max(0, xmax_px - xmin_px), max(0, ymax_px - ymin_px)]
    else:
        raise ValueError(f"Ordem de coordenadas não suportada: '{order}'")


def calculate_box_iou(box_a: Sequence[int], box_b: Sequence[int]) -> float:
    """Calcula Intersection over Union (IoU) entre duas caixas canônicas Gemini."""
    ymin_a, xmin_a, ymax_a, xmax_a = box_a
    ymin_b, xmin_b, ymax_b, xmax_b = box_b
    
    # Interseção
    inter_ymin = max(ymin_a, ymin_b)
    inter_xmin = max(xmin_a, xmin_b)
    inter_ymax = min(ymax_a, ymax_b)
    inter_xmax = min(xmax_a, xmax_b)
    
    inter_w = max(0, inter_xmax - inter_xmin)
    inter_h = max(0, inter_ymax - inter_ymin)
    inter_area = inter_w * inter_h
    
    # Áreas individuais
    area_a = max(0, xmax_a - xmin_a) * max(0, ymax_a - ymin_a)
    area_b = max(0, xmax_b - xmin_b) * max(0, ymax_b - ymin_b)
    
    union_area = area_a + area_b - inter_area
    if union_area <= 0:
        return 0.0
    return round(float(inter_area) / float(union_area), 4)


def format_qdrant_detected_objects(objects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normaliza e formata lista de objetos detectados para o payload da coleção capiau_making_of.
    
    Garante que cada objeto possua rótulo, categoria válida, realm ('production' | 'story')
    e coordenadas inteiras canônicas box_2d [ymin, xmin, ymax, xmax].
    """
    valid_categories = {"equipamento", "prop_cena", "figurino", "veiculo", "documento", "cenario", "outro"}
    valid_realms = {"production", "story"}
    
    formatted = []
    for obj in objects:
        label = str(obj.get("label") or obj.get("rotulo") or "objeto").strip().lower()
        cat = str(obj.get("category") or obj.get("categoria") or "outro").strip().lower()
        if cat not in valid_categories:
            cat = "outro"
            
        realm = str(obj.get("realm") or "production").strip().lower()
        if realm not in valid_realms:
            realm = "production"
            
        raw_box = obj.get("box_2d") or obj.get("bounding_box")
        if isinstance(raw_box, str):
            try:
                raw_box = json.loads(raw_box)
            except Exception:
                raw_box = [0, 0, 1000, 1000]
        elif not isinstance(raw_box, (list, tuple)) or len(raw_box) != 4:
            raw_box = [0, 0, 1000, 1000]
            
        box_2d = clamp_gemini_box(raw_box)
        conf = float(obj.get("confidence") or obj.get("confianca") or 0.8)
        conf = round(max(0.0, min(1.0, conf)), 2)
        
        formatted.append({
            "label": label,
            "category": cat,
            "realm": realm,
            "box_2d": box_2d,
            "confidence": conf,
        })
    return formatted


def format_qdrant_image_facets(objects: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Extrai facetas enriquecidas (objects, props, realm_tags) para o payload de capiau_images."""
    obj_labels = []
    prop_labels = []
    realm_tags = set()
    
    for item in objects:
        label = str(item.get("label") or item.get("rotulo") or "").strip().lower()
        cat = str(item.get("category") or item.get("categoria") or "").strip().lower()
        realm = str(item.get("realm") or "production").strip().lower()
        
        if label:
            if cat in {"prop_cena", "figurino"}:
                prop_labels.append(label)
            else:
                obj_labels.append(label)
        if cat:
            realm_tags.add(f"{realm}:{cat}")
            
    return {
        "objects": sorted(list(set(obj_labels))),
        "props": sorted(list(set(prop_labels))),
        "realm_tags": sorted(list(realm_tags)),
    }
