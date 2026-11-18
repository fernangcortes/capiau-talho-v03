"""Video Receipts JSON por exportação (proveniência, comando FFmpeg e integridade da saída)."""
from __future__ import annotations

import dataclasses
import datetime
import hashlib
import json
import os
import secrets
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_BLOCO_HASH = 64 * 1024


def caminho_recibo_para(destino_final: Path) -> Path:
    destino = Path(destino_final)
    return Path(f"{destino}.receipt.json")


def hash_rapido_arquivo(
    caminho: Path,
    *,
    limite_completo_bytes: int = 16 * 1024 * 1024,
) -> Optional[str]:
    """SHA-256 completo até `limite_completo_bytes`; acima disso, amostra determinística cabeça+cauda."""
    alvo = Path(caminho)
    try:
        if not alvo.is_file():
            return None
        tamanho = alvo.stat().st_size
    except OSError:
        return None

    h = hashlib.sha256()
    try:
        with alvo.open("rb") as fh:
            if tamanho <= limite_completo_bytes:
                while True:
                    bloco = fh.read(_BLOCO_HASH)
                    if not bloco:
                        break
                    h.update(bloco)
                return h.hexdigest()

            cabeca = fh.read(_BLOCO_HASH)
            fh.seek(max(0, tamanho - _BLOCO_HASH))
            cauda = fh.read(_BLOCO_HASH)
            h.update(str(tamanho).encode("ascii"))
            h.update(b"\x00")
            h.update(cabeca)
            h.update(cauda)
            return f"fast64k:{h.hexdigest()}"
    except OSError:
        return None


def _startupinfo():
    if os.name != "nt":
        return None
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return si


def _int_ou_none(val: Any) -> Optional[int]:
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def _float_ou_none(val: Any) -> Optional[float]:
    try:
        n = float(val)
    except (TypeError, ValueError):
        return None
    return n if n == n else None


def sondar_arquivo_saida(caminho: Path) -> Dict[str, Any]:
    """Sonda metadados reais do arquivo final com `ffprobe -of json`."""
    alvo = Path(caminho)
    if not alvo.is_file():
        return {"erro": "arquivo ausente"}
    ffprobe_bin = shutil.which("ffprobe")
    if not ffprobe_bin:
        return {"erro": "ffprobe indisponível"}

    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        str(alvo),
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10.0,
            startupinfo=_startupinfo(),
        )
    except Exception as exc:
        return {"erro": str(exc)}

    if proc.returncode != 0:
        return {"erro": (proc.stderr or proc.stdout or f"rc={proc.returncode}").strip()[:300]}

    try:
        bruto = json.loads(proc.stdout or "{}")
    except Exception as exc:
        return {"erro": f"json inválido: {exc}"}

    fmt = bruto.get("format") or {}
    streams = bruto.get("streams") or []
    v_stream = next((s for s in streams if s.get("codec_type") == "video"), {})
    a_stream = next((s for s in streams if s.get("codec_type") == "audio"), {})

    return {
        "format_name": fmt.get("format_name"),
        "duracao_s": _float_ou_none(fmt.get("duration")) or _float_ou_none(v_stream.get("duration")),
        "width": _int_ou_none(v_stream.get("width")),
        "height": _int_ou_none(v_stream.get("height")),
        "codec_name": v_stream.get("codec_name"),
        "pix_fmt": v_stream.get("pix_fmt"),
        "color_space": v_stream.get("color_space"),
        "nb_frames": _int_ou_none(v_stream.get("nb_frames")),
        "audio_codec": a_stream.get("codec_name"),
        "sample_rate": _int_ou_none(a_stream.get("sample_rate")),
        "channels": _int_ou_none(a_stream.get("channels")),
    }


def _sequence_sha256(sequencia: Any) -> str:
    if dataclasses.is_dataclass(sequencia) and not isinstance(sequencia, type):
        payload = dataclasses.asdict(sequencia)
    elif isinstance(sequencia, dict):
        payload = sequencia
    else:
        payload = repr(sequencia)
    serial = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    return hashlib.sha256(serial).hexdigest()


def gerar_recibo_export(
    sequencia: Any,
    pedido: Any,
    destino_final: Path,
    *,
    rel_midia: Any = None,
    parametros_saida: Optional[Dict[str, Any]] = None,
    comandos: Optional[List[List[str]]] = None,
    avisos: Optional[List[str]] = None,
    segmentado: bool = False,
) -> Dict[str, Any]:
    """Monta o dicionário estruturado de Video Receipt para uma exportação."""
    destino = Path(destino_final)
    param = dict(parametros_saida or {})
    fontes_map = getattr(rel_midia, "fontes", None) or {}
    proveniencia: List[Dict[str, Any]] = []
    for clipe_id in sorted(fontes_map.keys()):
        fonte = fontes_map[clipe_id]
        cam = getattr(fonte, "caminho", None)
        cam_path = Path(cam) if cam else None
        tam = None
        if cam_path is not None:
            try:
                if cam_path.is_file():
                    tam = cam_path.stat().st_size
            except OSError:
                tam = None
        proveniencia.append(
            {
                "clipe_id": getattr(fonte, "clipe_id", clipe_id),
                "tipo_midia": getattr(fonte, "tipo_midia", None),
                "classe": getattr(fonte, "classe", None),
                "status": getattr(fonte, "status", None),
                "arquivo": str(cam_path) if cam_path is not None else None,
                "tamanho_bytes": tam,
                "sha256": hash_rapido_arquivo(cam_path) if cam_path is not None else None,
            }
        )

    try:
        tamanho_saida = destino.stat().st_size if destino.is_file() else None
    except OSError:
        tamanho_saida = None

    faixa_obj = getattr(pedido, "faixa", None)
    escopo_obj = getattr(pedido, "escopo", None)

    return {
        "schema_version": 1,
        "gerado_em": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "timeline": {
            "timeline_id": getattr(pedido, "timeline_id", getattr(sequencia, "timeline_id", None)),
            "nome": getattr(sequencia, "nome", ""),
            "fps": float(getattr(sequencia, "fps", 24.0)),
            "largura": int(getattr(sequencia, "largura", 1920)),
            "altura": int(getattr(sequencia, "altura", 1080)),
            "duracao_s": round(float(sequencia.duracao_s()), 6) if hasattr(sequencia, "duracao_s") else None,
            "sequence_sha256": _sequence_sha256(sequencia),
        },
        "pedido": {
            "kind": getattr(pedido, "kind", None),
            "preset": getattr(pedido, "preset", None),
            "faixa": dataclasses.asdict(faixa_obj) if dataclasses.is_dataclass(faixa_obj) else None,
            "escopo": dataclasses.asdict(escopo_obj) if dataclasses.is_dataclass(escopo_obj) else None,
            "overrides": dict(getattr(pedido, "overrides", {}) or {}),
            "usar_proxies": bool(getattr(pedido, "usar_proxies", False)),
            "permitir_fallback_proxy": bool(getattr(pedido, "permitir_fallback_proxy", False)),
            "usa_proxy_fallback": bool(getattr(rel_midia, "usa_proxy_fallback", False)),
        },
        "proveniencia_midia": proveniencia,
        "execucao": {
            "segmentado": bool(segmentado),
            "total_segmentos": len(comandos or []),
            "encoder": param.get("encoder"),
            "encoder_hardware": param.get("encoder_hardware"),
            "parametros_saida": param,
            "comandos_ffmpeg": [[str(tok) for tok in cmd] for cmd in (comandos or [])],
            "avisos": [str(a) for a in (avisos or [])],
        },
        "saida": {
            "caminho": str(destino),
            "nome_arquivo": destino.name,
            "tamanho_bytes": tamanho_saida,
            "sha256": hash_rapido_arquivo(destino),
            "probe": sondar_arquivo_saida(destino),
        },
    }


def gravar_recibo_export(
    sequencia: Any,
    pedido: Any,
    destino_final: Path,
    *,
    rel_midia: Any = None,
    parametros_saida: Optional[Dict[str, Any]] = None,
    comandos: Optional[List[List[str]]] = None,
    avisos: Optional[List[str]] = None,
    segmentado: bool = False,
) -> Tuple[Path, Dict[str, Any]]:
    """Gera e grava atomicamente `<destino_final>.receipt.json`."""
    destino = Path(destino_final)
    caminho_recibo = caminho_recibo_para(destino)
    caminho_recibo.parent.mkdir(parents=True, exist_ok=True)
    recibo = gerar_recibo_export(
        sequencia,
        pedido,
        destino,
        rel_midia=rel_midia,
        parametros_saida=parametros_saida,
        comandos=comandos,
        avisos=avisos,
        segmentado=segmentado,
    )
    tmp = caminho_recibo.with_name(f".{caminho_recibo.name}.{secrets.token_hex(4)}.tmp")
    tmp.write_text(json.dumps(recibo, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, caminho_recibo)
    return caminho_recibo, recibo
