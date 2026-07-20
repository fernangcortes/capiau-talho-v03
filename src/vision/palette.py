"""Paleta e temperatura de cor (E2.D2) — OpenCV puro, sem custo de API.

k-means sobre a imagem reduzida extrai as cores dominantes; a temperatura
(quente/neutro/frio) sai do matiz ponderado pela participação e saturação de
cada cluster: tons terrosos/dourados puxam para 'quente', azuis/cianos para
'frio', e imagens dessaturadas ou equilibradas ficam 'neutro'.
"""
import colorsys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

PALETTE_TEMPS = ("quente", "neutro", "frio")


def _dominant_colors(image_bgr: np.ndarray, k: int = 4) -> List[Tuple[Tuple[int, int, int], float]]:
    """[(rgb, participacao)] das k cores dominantes, por k-means (OpenCV)."""
    import cv2
    small = cv2.resize(image_bgr, (64, 64), interpolation=cv2.INTER_AREA)
    pixels = small.reshape(-1, 3).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(pixels, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.flatten(), minlength=k).astype(np.float64)
    shares = counts / counts.sum()
    out = []
    for center, share in sorted(zip(centers, shares), key=lambda cs: -cs[1]):
        b, g, r = (int(round(c)) for c in center)
        out.append(((r, g, b), float(share)))
    return out


def _temperature_score(rgb: Tuple[int, int, int]) -> Tuple[float, float]:
    """(peso_quente, peso_frio) de uma cor, ponderados por saturação e valor.

    Matiz (H em graus): vermelhos/laranjas/amarelos (< 70 ou > 320) = quente;
    azuis/cianos (170–280) = frio; o resto (verdes, magentas) não vota.
    Cores dessaturadas ou muito escuras votam fraco — cinza não tem temperatura.
    """
    r, g, b = (c / 255.0 for c in rgb)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    hue_deg = h * 360.0
    strength = s * max(v, 0.15)  # dessaturado/escuro -> voto fraco
    if hue_deg < 70.0 or hue_deg > 320.0:
        return strength, 0.0
    if 170.0 <= hue_deg <= 280.0:
        return 0.0, strength
    return 0.0, 0.0


def classify_palette(image_bgr: np.ndarray, k: int = 4) -> Dict:
    """{'palette_hex': [...], 'palette_temp': 'quente|neutro|frio', 'warm': x, 'cold': y}."""
    colors = _dominant_colors(image_bgr, k=k)
    palette_hex = ["#{:02x}{:02x}{:02x}".format(*rgb) for rgb, _ in colors]

    warm = cold = 0.0
    for rgb, share in colors:
        w, c = _temperature_score(rgb)
        warm += w * share
        cold += c * share

    # Margem mínima: sem ela, qualquer resto de matiz decidiria a temperatura
    # de uma imagem essencialmente cinza.
    if warm < 0.04 and cold < 0.04:
        temp = "neutro"
    elif warm >= cold * 1.4:
        temp = "quente"
    elif cold >= warm * 1.4:
        temp = "frio"
    else:
        temp = "neutro"
    return {"palette_hex": palette_hex, "palette_temp": temp,
            "warm": round(warm, 4), "cold": round(cold, 4)}


def classify_palette_file(image_path: Path, k: int = 4) -> Optional[Dict]:
    """Versão por arquivo (proxy WebP/JPEG). None em falha — nunca levanta."""
    try:
        import cv2
        data = np.fromfile(str(image_path), dtype=np.uint8)  # caminho com acento no Windows
        img = cv2.imdecode(data, cv2.IMREAD_COLOR)
        if img is None:
            return None
        return classify_palette(img, k=k)
    except Exception as e:
        print(f"[Palette] Falha ao extrair paleta de {Path(image_path).name}: {e}")
        return None
