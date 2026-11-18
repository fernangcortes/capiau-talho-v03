"""Ajudantes do harness de regressão do render (Frente B — Nível 1)."""
from __future__ import annotations

import copy
import json
import subprocess
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence

import numpy as np

from src.export.video_render import comando, midia, modelo, titulos

from .fontes import garantir_midias_sinteticas, mapa_midias_sinteticas


def comando_intermediario(
    cmd: Sequence[str],
    destino_mkv: Path,
    *,
    threads: Optional[int] = None,
    filter_threads: Optional[int] = None,
) -> List[str]:
    """Substitui a cauda H.264/AAC de `montar_comando` por FFV1 + PCM s16le determinístico.

    Valida a forma esperada da cauda (`comando.py:729-745`) e preserva `-r` e `-t`.
    """
    tokens = [str(t) for t in cmd]
    if "-c:v" not in tokens:
        raise AssertionError("Cauda inesperada em montar_comando: flag '-c:v' ausente.")
    idx_cv = tokens.index("-c:v")
    cauda = tokens[idx_cv:]

    if "-r" not in cauda or "-t" not in cauda:
        raise AssertionError("Cauda inesperada em montar_comando: '-r' ou '-t' ausente.")
    r_val = cauda[cauda.index("-r") + 1]
    t_val = cauda[cauda.index("-t") + 1]
    tem_audio = "-c:a" in cauda

    cabeca = list(tokens[:idx_cv])
    if filter_threads is not None and "-filter_complex" in cabeca:
        idx_fc = cabeca.index("-filter_complex")
        cabeca[idx_fc:idx_fc] = [
            "-filter_threads",
            str(int(filter_threads)),
            "-filter_complex_threads",
            str(int(filter_threads)),
        ]

    nova_cauda: List[str] = ["-c:v", "ffv1", "-level", "3"]
    if tem_audio:
        nova_cauda += ["-c:a", "pcm_s16le"]
    else:
        nova_cauda += ["-an"]
    nova_cauda += ["-r", r_val, "-t", t_val, "-fps_mode", "cfr"]
    if threads is not None:
        nova_cauda += ["-threads", str(int(threads))]
    nova_cauda += ["-y", str(destino_mkv)]
    return cabeca + nova_cauda


def resolver_caminhos_fontes(
    cenario: Dict[str, Any],
    fontes_override: Optional[Dict[str, Path]] = None,
) -> Dict[str, Path]:
    garantir_midias_sinteticas()
    mapa_padrao = mapa_midias_sinteticas()
    resolvidas: Dict[str, Path] = {}
    for chave, valor in (cenario.get("fontes") or {}).items():
        if fontes_override and str(chave) in fontes_override:
            resolvidas[str(chave)] = Path(fontes_override[str(chave)])
            continue
        p = Path(str(valor))
        if p.is_file():
            resolvidas[str(chave)] = p
        elif str(valor) in mapa_padrao:
            resolvidas[str(chave)] = mapa_padrao[str(valor)]
        else:
            raise FileNotFoundError(f"Fonte sintética desconhecida para chave {chave!r}: {valor!r}")
    if fontes_override:
        for chave, cam in fontes_override.items():
            resolvidas[str(chave)] = Path(cam)
    return resolvidas


def construir_seq_e_pedido(
    cenario: Dict[str, Any],
    *,
    mutar_sequencia: Optional[Callable[[Dict[str, Any]], None]] = None,
    mutar_pedido: Optional[Callable[[Dict[str, Any]], None]] = None,
):
    seq_dict = copy.deepcopy(cenario["sequencia"])
    if mutar_sequencia is not None:
        mutar_sequencia(seq_dict)
    seq = modelo.normalizar(seq_dict, nome=cenario.get("id", "cenario"), timeline_id=1)

    ped_raw = copy.deepcopy(cenario.get("pedido") or {})
    if mutar_pedido is not None:
        mutar_pedido(ped_raw)

    faixa_raw = ped_raw.get("faixa")
    faixa = modelo.Faixa(**faixa_raw) if isinstance(faixa_raw, dict) else modelo.Faixa()
    escopo_raw = ped_raw.get("escopo")
    escopo = modelo.Escopo(**escopo_raw) if isinstance(escopo_raw, dict) else modelo.Escopo()

    overrides = dict(ped_raw.get("overrides") or {})
    if "resolution" not in overrides:
        w, h = cenario.get("resolucao") or [seq.largura, seq.altura]
        overrides["resolution"] = f"{int(w)}x{int(h)}"

    pedido = modelo.Pedido(
        timeline_id=1,
        kind=str(ped_raw.get("kind") or modelo.TIPO_MASTER),
        preset=str(ped_raw.get("preset") or "master_1080"),
        faixa=faixa,
        escopo=escopo,
        overrides=overrides,
        permitir_fallback_proxy=bool(ped_raw.get("permitir_fallback_proxy", False)),
        usar_proxies=bool(ped_raw.get("usar_proxies", False)),
    )
    return seq, pedido


def renderizar_cenario(
    cenario: Dict[str, Any],
    tmp_path: Path,
    *,
    modo: str = "intermediario",
    mutar_sequencia: Optional[Callable[[Dict[str, Any]], None]] = None,
    mutar_pedido: Optional[Callable[[Dict[str, Any]], None]] = None,
    fontes_override: Optional[Dict[str, Path]] = None,
    com_titulos: Optional[bool] = None,
    threads: Optional[int] = None,
    filter_threads: Optional[int] = None,
    nome_saida: Optional[str] = None,
) -> Dict[str, Any]:
    """Monta e executa o render de um cenário sem tocar no banco nem em drive externo."""
    tmp_path = Path(tmp_path)
    tmp_path.mkdir(parents=True, exist_ok=True)
    seq, pedido = construir_seq_e_pedido(
        cenario, mutar_sequencia=mutar_sequencia, mutar_pedido=mutar_pedido
    )
    mapa_fontes = resolver_caminhos_fontes(cenario, fontes_override=fontes_override)

    def _buscar_midia(_tipo: str, midia_id: int) -> Optional[Dict[str, Any]]:
        cam = mapa_fontes.get(str(midia_id))
        if cam is None:
            return None
        return {
            "id": int(midia_id),
            "filepath": str(cam),
            "proxy_path": str(cam),
            "duration": 60.0,
        }

    rel_midia = midia.resolver_fontes(
        seq,
        pedido,
        buscar_midia=_buscar_midia,
        checar_drive=lambda _l: True,
    )
    if rel_midia.recusado:
        raise RuntimeError(f"Resolução de mídia recusada: {rel_midia.recusas}")

    ext = "mkv" if modo == "intermediario" else "mp4"
    destino = tmp_path / (nome_saida or f"{cenario.get('id', 'saida')}.{ext}")

    usar_titulos = any(c.tipo == "text" for c in seq.clipes) if com_titulos is None else bool(com_titulos)
    gerador = None
    try:
        fn_titulos = None
        if usar_titulos:
            pasta_tit = tmp_path / "titulos_cache"
            gerador = titulos.GeradorTitulos(pasta_tit)

            def fn_titulos(s_obj, escopo, ini_s, fim_s):
                return titulos.preparar_titulos(s_obj, escopo, ini_s, fim_s, gerador, pasta_tit / "listas")

        res_cmd = comando.montar_comando(
            seq,
            pedido,
            destino,
            rel_midia=rel_midia,
            destino_validado=True,
            titulos=fn_titulos,
        )
    finally:
        if gerador is not None:
            gerador.fechar()

    cmd_exec = (
        comando_intermediario(
            res_cmd["cmd"],
            destino,
            threads=threads,
            filter_threads=filter_threads,
        )
        if modo == "intermediario"
        else list(res_cmd["cmd"])
    )
    proc = subprocess.run(cmd_exec, capture_output=True)
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[-3000:]
        raise RuntimeError(f"FFmpeg falhou (rc={proc.returncode}):\n{err}")

    return {
        "caminho": destino,
        "cmd": cmd_exec,
        "res_comando": res_cmd,
        "sequencia": seq,
        "pedido": pedido,
        "rel_midia": rel_midia,
    }


def sondar_video(caminho_video: Path) -> Dict[str, Any]:
    """Executa `ffprobe -count_frames` e devolve metadados estruturados do arquivo."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-count_frames",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        str(caminho_video),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True)
    bruto = json.loads(proc.stdout or "{}")
    fmt = bruto.get("format") or {}
    streams = bruto.get("streams") or []
    v = next((s for s in streams if s.get("codec_type") == "video"), {})
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)

    def _i(val: Any) -> Optional[int]:
        try:
            return int(val)
        except (TypeError, ValueError):
            return None

    def _f(val: Any) -> Optional[float]:
        try:
            return float(val)
        except (TypeError, ValueError):
            return None

    return {
        "width": _i(v.get("width")),
        "height": _i(v.get("height")),
        "nb_read_frames": _i(v.get("nb_read_frames")) or _i(v.get("nb_frames")),
        "nb_frames": _i(v.get("nb_frames")),
        "duration": _f(fmt.get("duration")) or _f(v.get("duration")),
        "avg_frame_rate": v.get("avg_frame_rate"),
        "r_frame_rate": v.get("r_frame_rate"),
        "color_space": v.get("color_space"),
        "color_primaries": v.get("color_primaries"),
        "color_transfer": v.get("color_transfer"),
        "color_range": v.get("color_range"),
        "pix_fmt": v.get("pix_fmt"),
        "profile": v.get("profile"),
        "codec_name": v.get("codec_name"),
        "tem_audio": a is not None,
        "audio_codec": a.get("codec_name") if a else None,
        "sample_rate": _i(a.get("sample_rate")) if a else None,
        "channels": _i(a.get("channels")) if a else None,
        "audio_nb_read_frames": _i(a.get("nb_read_frames")) if a else None,
    }


def extrair_quadros(
    caminho_video: Path,
    indices: Optional[Sequence[int]] = None,
    *,
    largura: Optional[int] = None,
    altura: Optional[int] = None,
    matriz_in: Optional[str] = None,
) -> np.ndarray:
    """Extrai quadros RGB24 `(N, H, W, 3)` uint8, por seleção exata de índice quando dada."""
    info = sondar_video(caminho_video)
    w = int(largura or info["width"])
    h = int(altura or info["height"])

    vf_partes: List[str] = []
    unicos_ordenados: Optional[List[int]] = None
    if indices is not None:
        lista_idx = [int(i) for i in indices]
        if not lista_idx:
            return np.zeros((0, h, w, 3), dtype=np.uint8)
        unicos_ordenados = sorted(set(lista_idx))
        expr_sel = "+".join(f"eq(n\\,{i})" for i in unicos_ordenados)
        vf_partes.append(f"select='{expr_sel}'")
        vf_partes.append("setpts=N/FRAME_RATE/TB")

    if matriz_in:
        vf_partes.append(
            f"scale=in_color_matrix={matriz_in}:flags=accurate_rnd+full_chroma_int"
        )
    vf_partes.append("format=rgb24")

    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-i",
        str(caminho_video),
        "-vf",
        ",".join(vf_partes),
        "-fps_mode",
        "passthrough",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"Falha ao extrair quadros de {caminho_video}: {proc.stderr.decode(errors='replace')}"
        )

    tam_quadro = w * h * 3
    if tam_quadro <= 0:
        raise ValueError(f"Dimensões inválidas ({w}x{h}) para extração de quadros.")
    total_bytes = len(proc.stdout)
    if total_bytes % tam_quadro != 0:
        raise AssertionError(
            f"Tamanho rawvideo {total_bytes} não é múltiplo exato de {w}x{h}x3 ({tam_quadro})."
        )
    n_lidos = total_bytes // tam_quadro
    lote = np.frombuffer(proc.stdout, dtype=np.uint8).reshape((n_lidos, h, w, 3)).copy()

    if unicos_ordenados is not None:
        if n_lidos != len(unicos_ordenados):
            raise AssertionError(
                f"Contagem divergente na extração por índice: pedido={len(unicos_ordenados)} "
                f"({unicos_ordenados}), lido={n_lidos}."
            )
        pos_map = {idx: pos for pos, idx in enumerate(unicos_ordenados)}
        ordem = [pos_map[int(i)] for i in indices]  # type: ignore[arg-type]
        return lote[ordem]
    return lote


def extrair_audio(
    caminho_video: Path,
    *,
    sr: int = 48000,
    canais: int = 2,
) -> np.ndarray:
    """Extrai áudio decodificado em float32 `(amostras, canais)` no intervalo `[-1, 1]`."""
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-i",
        str(caminho_video),
        "-vn",
        "-ac",
        str(int(canais)),
        "-ar",
        str(int(sr)),
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"Falha ao extrair áudio de {caminho_video}: {proc.stderr.decode(errors='replace')}"
        )
    bruto = np.frombuffer(proc.stdout, dtype="<f4")
    if len(bruto) == 0:
        return np.zeros((0, canais), dtype=np.float32)
    n_amostras = len(bruto) // canais
    return bruto[: n_amostras * canais].reshape((n_amostras, canais)).copy()


def framemd5_video(caminho_video: Path) -> List[str]:
    """Extrai assinaturas `framemd5` do fluxo de vídeo para checagem de determinismo."""
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-i",
        str(caminho_video),
        "-map",
        "0:v:0",
        "-f",
        "framemd5",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return [ln.strip() for ln in proc.stdout.splitlines() if ln.strip() and not ln.startswith("#")]
