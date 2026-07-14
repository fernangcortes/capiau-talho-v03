"""Segmentação real de vídeo: shots (cortes), beats (deriva visual) e movimento de câmera.

Etapa 2 (E2.A) do plano de implementação. Roda 100% local (PySceneDetect + OpenCV),
preferencialmente sobre o proxy 720p para velocidade. Nenhuma chamada de API.
"""
from pathlib import Path
from typing import List, Dict, Any, Optional, Callable

import cv2
import numpy as np
from scenedetect import open_video, SceneManager, ContentDetector, AdaptiveDetector


def detect_shots(video_path: Path, threshold: float = 27.0) -> List[Dict[str, float]]:
    """Detecta cortes de cena (shots) usando ContentDetector + AdaptiveDetector.

    Retorna lista de {'start', 'end'} em segundos. Lista vazia = falha ou
    nenhum corte detectado (o chamador trata como shot único).
    """
    if not video_path.exists():
        print(f"[Segmentation] Arquivo não encontrado: {video_path}")
        return []

    try:
        video = open_video(str(video_path))
        manager = SceneManager()
        manager.add_detector(ContentDetector(threshold=threshold))
        manager.add_detector(AdaptiveDetector())
        manager.detect_scenes(video, show_progress=False)
        scene_list = manager.get_scene_list()

        if not scene_list:
            return []

        shots = [
            {"start": start_tc.get_seconds(), "end": end_tc.get_seconds()}
            for start_tc, end_tc in scene_list
        ]
        print(f"[Segmentation] Detectados {len(shots)} shots para: {video_path.name}")
        return shots
    except Exception as e:
        print(f"[Segmentation] Falha ao processar {video_path.name} com PySceneDetect: {e}")
        return []


def _hsv_embedding(frame_bgr: np.ndarray) -> np.ndarray:
    """Assinatura visual barata: histograma HSV 3D normalizado (fallback do CLIP)."""
    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [12, 6, 4], [0, 180, 0, 256, 0, 256])
    vec = hist.flatten().astype(np.float32)
    norm = np.linalg.norm(vec)
    return vec / norm if norm > 0 else vec


def _cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return 1.0 - float(np.dot(a, b) / (na * nb))


def detect_beats(
    video_path: Path,
    shots: List[Dict[str, float]],
    min_beat_shot_s: float = 20.0,
    sample_interval_s: float = 1.5,
    drift_threshold: float = 0.35,
    embed_fn: Optional[Callable[[np.ndarray], np.ndarray]] = None,
) -> List[Dict[str, Any]]:
    """Divide shots longos em beats por deriva de embedding visual.

    Amostra 1 frame a cada `sample_interval_s` dentro de shots mais longos que
    `min_beat_shot_s`; abre beat novo quando a distância cosseno ao centróide
    corrente ultrapassa `drift_threshold`. `embed_fn` permite plugar o CLIP
    (E2.B); sem ele usa histograma HSV.
    Retorna lista de {'start', 'end', 'reason'} apenas para os beats criados.
    """
    embed = embed_fn or _hsv_embedding
    beats: List[Dict[str, Any]] = []

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"[Segmentation] OpenCV não conseguiu abrir: {video_path.name}")
        return []

    try:
        for shot in shots:
            shot_len = shot["end"] - shot["start"]
            if shot_len <= min_beat_shot_s:
                continue

            centroid: Optional[np.ndarray] = None
            n_in_beat = 0
            beat_start = shot["start"]
            t = shot["start"]
            shot_beats: List[Dict[str, Any]] = []

            while t < shot["end"]:
                cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
                ok, frame = cap.read()
                if not ok or frame is None:
                    t += sample_interval_s
                    continue

                vec = embed(frame)
                if centroid is None:
                    centroid, n_in_beat = vec, 1
                else:
                    dist = _cosine_distance(vec, centroid)
                    if dist > drift_threshold and (t - beat_start) >= sample_interval_s * 2:
                        shot_beats.append({
                            "start": beat_start, "end": t,
                            "reason": f"deriva visual (dist {dist:.2f})",
                        })
                        beat_start = t
                        centroid, n_in_beat = vec, 1
                    else:
                        # centróide como média incremental do beat corrente
                        centroid = (centroid * n_in_beat + vec) / (n_in_beat + 1)
                        n_in_beat += 1
                t += sample_interval_s

            if shot_beats:  # fecha o último beat até o fim do shot
                shot_beats.append({
                    "start": beat_start, "end": shot["end"],
                    "reason": "trecho final do plano",
                })
                beats.extend(shot_beats)
    finally:
        cap.release()

    if beats:
        print(f"[Segmentation] {len(beats)} beats por deriva visual em {video_path.name}")
    return beats


def classify_motion(video_path: Path, start: float, end: float) -> str:
    """Classifica o movimento de câmera dominante do trecho.

    Fluxo esparso (goodFeaturesToTrack + Lucas-Kanade) → translação média e
    jitter → `static | pan | tilt | walk | handheld | whip`.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return ""

    try:
        span = max(end - start, 0.5)
        n_pairs = min(6, max(2, int(span)))  # até 6 pares de frames pelo trecho
        step = span / (n_pairs + 1)
        dxs, dys, residuals = [], [], []

        for i in range(n_pairs):
            t0 = start + step * (i + 1)
            cap.set(cv2.CAP_PROP_POS_MSEC, t0 * 1000.0)
            ok0, f0 = cap.read()
            cap.set(cv2.CAP_PROP_POS_MSEC, (t0 + 0.2) * 1000.0)
            ok1, f1 = cap.read()
            if not (ok0 and ok1) or f0 is None or f1 is None:
                continue

            g0 = cv2.cvtColor(cv2.resize(f0, (480, 270)), cv2.COLOR_BGR2GRAY)
            g1 = cv2.cvtColor(cv2.resize(f1, (480, 270)), cv2.COLOR_BGR2GRAY)
            pts = cv2.goodFeaturesToTrack(g0, maxCorners=120, qualityLevel=0.01, minDistance=8)
            if pts is None or len(pts) < 8:
                continue
            nxt, status, _ = cv2.calcOpticalFlowPyrLK(g0, g1, pts, None)
            good0 = pts[status.flatten() == 1]
            good1 = nxt[status.flatten() == 1]
            if len(good0) < 8:
                continue

            m, inliers = cv2.estimateAffinePartial2D(good0, good1)
            if m is None:
                continue
            # px/s na resolução reduzida (par separado por 0.2s)
            dxs.append(m[0, 2] / 0.2)
            dys.append(m[1, 2] / 0.2)
            residuals.append(1.0 - (float(np.sum(inliers)) / len(good0) if inliers is not None else 0.0))

        if not dxs:
            return ""

        dx, dy = float(np.mean(dxs)), float(np.mean(dys))
        mag = float(np.hypot(dx, dy))
        jitter = float(np.std(dxs) + np.std(dys))
        residual = float(np.mean(residuals))

        if mag < 4.0 and jitter < 6.0:
            return "static"
        if mag > 200.0:
            return "whip"
        if jitter > 40.0 or residual > 0.5:
            # movimento sustentado + muito jitter = deslocamento a pé
            return "walk" if mag > 25.0 else "handheld"
        if abs(dx) > 2.5 * abs(dy):
            return "pan"
        if abs(dy) > 2.5 * abs(dx):
            return "tilt"
        return "handheld" if jitter > 15.0 else "pan"
    except Exception as e:
        print(f"[Segmentation] Falha no fluxo óptico ({start:.1f}-{end:.1f}s): {e}")
        return ""
    finally:
        cap.release()


def segment_video(
    video_path: Path,
    duration: float,
    detect_threshold: float = 27.0,
    min_beat_shot_s: float = 20.0,
    sample_interval_s: float = 1.5,
    drift_threshold: float = 0.35,
    motion_enabled: bool = True,
    embed_fn: Optional[Callable[[np.ndarray], np.ndarray]] = None,
) -> List[Dict[str, Any]]:
    """Orquestra shots + beats + movimento e devolve a lista final de segmentos.

    Retorna [{'start', 'end', 'kind', 'reason', 'motion_label'}] ordenada no tempo.
    Shots que geraram beats são substituídos pelos beats (granularidade final).
    """
    shots = detect_shots(video_path, threshold=detect_threshold)
    if not shots:
        shots = [{"start": 0.0, "end": max(duration, 0.0)}]  # plano-sequência: 1 shot único

    beats = detect_beats(
        video_path, shots,
        min_beat_shot_s=min_beat_shot_s,
        sample_interval_s=sample_interval_s,
        drift_threshold=drift_threshold,
        embed_fn=embed_fn,
    )

    # Shots cobertos por beats saem da lista final; os demais entram como estão
    def _covered(shot: Dict[str, float]) -> bool:
        return any(b["start"] >= shot["start"] - 0.01 and b["end"] <= shot["end"] + 0.01 for b in beats)

    segments: List[Dict[str, Any]] = []
    for shot in shots:
        if not _covered(shot):
            segments.append({
                "start": shot["start"], "end": shot["end"],
                "kind": "shot", "reason": "corte detectado" if len(shots) > 1 else "plano único",
                "motion_label": "",
            })
    for b in beats:
        segments.append({
            "start": b["start"], "end": b["end"],
            "kind": "beat", "reason": b.get("reason", ""),
            "motion_label": "",
        })

    segments.sort(key=lambda s: s["start"])

    if motion_enabled:
        for seg in segments:
            seg["motion_label"] = classify_motion(video_path, seg["start"], seg["end"])

    return segments
