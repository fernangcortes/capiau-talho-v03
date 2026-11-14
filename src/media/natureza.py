"""Natureza do material: vídeo ou áudio (docs/planos/PLANO_AUDIO_CATEGORIAS.md, camada 1).

Determinística, sem IA. É áudio quando o arquivo não tem imagem (nenhuma faixa de
vídeo; capa de MP3 não conta) ou quando a imagem é parada (trilha exportada com um
quadro fixo, como o vídeo 555). Material de áudio não passa pela triagem por visão,
pela análise de quadros nem pelo CLIP.

Na dúvida (ffprobe falhou, arquivo offline, vídeo curto demais) a resposta é
'video': a análise segue como sempre foi.
"""
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

NATUREZA_VIDEO = "video"
NATUREZA_AUDIO = "audio"

EXTENSOES_AUDIO = (".wav", ".mp3", ".m4a", ".bwf")

# Imagem parada: quadros espalhados pela duração, comparados em cinza 160x90.
# Medido em 07/10/2026: o 555 dá 0,0 em todos os pares; 25 vídeos reais sorteados
# do acervo dão no mínimo 1,15 no par mais parecido e >= 3 no mais diferente.
# O critério é o par MAIS diferente ficar abaixo do limiar.
POSICOES_QUADROS = (0.10, 0.35, 0.60, 0.85)
LIMIAR_IMAGEM_PARADA = 0.5
DURACAO_MINIMA_S = 2.0
_W, _H = 160, 90


def _startupinfo():
    if os.name != "nt":
        return None
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return si


def _sondar(caminho: Path) -> Optional[Dict[str, Any]]:
    try:
        res = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(caminho)],
            capture_output=True, text=True, startupinfo=_startupinfo(), check=True, timeout=60)
        return json.loads(res.stdout)
    except Exception as e:
        print(f"[Natureza] ffprobe falhou em {caminho.name}: {e}")
        return None


def _faixas_de_imagem(streams: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Faixas de vídeo de verdade: a capa embutida no MP3/M4A (attached_pic) não é imagem do material."""
    return [s for s in streams
            if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")]


def _quadro_cinza(caminho: Path, instante: float):
    import numpy as np
    try:
        res = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{instante:.3f}", "-i", str(caminho), "-frames:v", "1",
             "-vf", f"scale={_W}:{_H},format=gray", "-f", "rawvideo", "-"],
            capture_output=True, startupinfo=_startupinfo(), timeout=60)
    except Exception:
        return None
    if len(res.stdout) != _W * _H:
        return None
    return np.frombuffer(res.stdout, np.uint8).astype(np.int16)


def diferencas_entre_quadros(caminho: Path, duracao: float) -> List[float]:
    """Diferença média de pixel (0-255) entre quadros vizinhos espalhados pela duração."""
    import numpy as np
    quadros = [q for q in (_quadro_cinza(caminho, duracao * p) for p in POSICOES_QUADROS) if q is not None]
    return [float(np.abs(quadros[i] - quadros[i + 1]).mean()) for i in range(len(quadros) - 1)]


def imagem_parada(caminho: Path, duracao: float) -> bool:
    if duracao < DURACAO_MINIMA_S:
        return False
    difs = diferencas_entre_quadros(caminho, duracao)
    # Menos de 3 quadros legíveis não é prova de nada
    return len(difs) >= 2 and max(difs) < LIMIAR_IMAGEM_PARADA


def detectar_natureza(caminho: Path) -> str:
    """'audio' sem faixa de imagem ou com imagem parada (e com som); senão 'video'."""
    caminho = Path(caminho)
    info = _sondar(caminho)
    if not info:
        return NATUREZA_VIDEO
    streams = info.get("streams") or []
    tem_som = any(s.get("codec_type") == "audio" for s in streams)
    if not tem_som:
        # Sem som não é material de áudio, nem que a imagem seja parada
        return NATUREZA_VIDEO
    if not _faixas_de_imagem(streams):
        return NATUREZA_AUDIO
    try:
        duracao = float((info.get("format") or {}).get("duration") or 0.0)
    except (TypeError, ValueError):
        duracao = 0.0
    return NATUREZA_AUDIO if imagem_parada(caminho, duracao) else NATUREZA_VIDEO
