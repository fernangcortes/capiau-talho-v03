"""Utilidades de I/O do OpenCV à prova de caminhos Unicode (Windows).

O `cv2.imread`/`cv2.imwrite` usam a API ANSI no Windows e falham silenciosamente
quando o caminho absoluto contém acentos (ex: 'C:\\Users\\Programação\\...').
Lendo/escrevendo os bytes via numpy e decodificando em memória o problema some.
"""
from pathlib import Path
from typing import Optional, Union

import cv2
import numpy as np


def imread_unicode(path: Union[str, Path], flags: int = cv2.IMREAD_COLOR) -> Optional[np.ndarray]:
    """Equivalente a cv2.imread que funciona com caminhos acentuados. None em falha."""
    try:
        data = np.fromfile(str(path), dtype=np.uint8)
        if data.size == 0:
            return None
        return cv2.imdecode(data, flags)
    except Exception as e:
        print(f"[cv_utils] Falha ao ler imagem {path}: {e}")
        return None


def imwrite_unicode(path: Union[str, Path], img: np.ndarray) -> bool:
    """Equivalente a cv2.imwrite que funciona com caminhos acentuados."""
    try:
        ext = Path(path).suffix or ".png"
        ok, buf = cv2.imencode(ext, img)
        if not ok:
            return False
        buf.tofile(str(path))
        return True
    except Exception as e:
        print(f"[cv_utils] Falha ao escrever imagem {path}: {e}")
        return False
