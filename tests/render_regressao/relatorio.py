"""Geração de relatórios HTML e imagens lado a lado em `tests/render_regressao/_saida/`."""
from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
from PIL import Image

from .metricas import mapa_diferenca_x8


def salvar_comparacao_quadro(
    ref_rgb: np.ndarray,
    atual_rgb: np.ndarray,
    destino_png: Path,
) -> Path:
    """Salva tira horizontal `referência | atual | diferença ×8` em PNG."""
    ref = np.asarray(ref_rgb, dtype=np.uint8)
    atual = np.asarray(atual_rgb, dtype=np.uint8)
    diff = mapa_diferenca_x8(ref, atual)
    combinado = np.concatenate([ref, atual, diff], axis=1)
    destino_png.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(combinado, "RGB").save(destino_png, format="PNG")
    return destino_png


def gerar_relatorio_html(
    cenario_id: str,
    resultado: Dict[str, Any],
    pasta_saida_cenario: Path,
) -> Path:
    """Grava `resultado.json` e `index.html` em `_saida/<id>/`."""
    pasta = Path(pasta_saida_cenario)
    pasta.mkdir(parents=True, exist_ok=True)
    json_path = pasta / "resultado.json"
    json_path.write_text(
        json.dumps(resultado, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )

    quadros_info: List[Dict[str, Any]] = resultado.get("quadros") or []
    linhas_html: List[str] = []
    for item in quadros_info:
        q_idx = item.get("quadro")
        ok = bool(item.get("ok", True))
        cor_badge = "#2ecc71" if ok else "#e74c3c"
        diff_rel = item.get("diff_rel") or ""
        img_tag = (
            f'<div><img src="{html.escape(str(diff_rel))}" style="max-width:100%;border:1px solid #333"></div>'
            if diff_rel
            else ""
        )
        linhas_html.append(
            f"<section style='margin:16px 0;padding:12px;border:1px solid #2b2b33;border-radius:8px;background:#141418'>"
            f"<h3 style='margin:0 0 8px'>Quadro {q_idx} "
            f"<span style='color:{cor_badge}'>{'OK' if ok else 'FALHA'}</span></h3>"
            f"<pre style='margin:0 0 8px;color:#cbd5e1'>{html.escape(json.dumps(item, ensure_ascii=False))}</pre>"
            f"{img_tag}</section>"
        )

    perfil = html.escape(str(resultado.get("perfil") or "desconhecido"))
    status_txt = "APROVADO" if resultado.get("ok", True) else "DIVERGENTE"
    aviso_env = ""
    if resultado.get("ambiente_mudou"):
        aviso_env = (
            "<p style='padding:8px 12px;background:#3a2a12;border:1px solid #f59e0b;border-radius:6px;color:#fde68a'>"
            "Ambiente (FFmpeg/buildconf) mudou desde a aprovação; perfil em modo deriva. "
            "Se a diferença visual for legítima, revise os PNGs e execute <code>scripts/render_regressao.py aprovar</code>.</p>"
        )

    pagina = f"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Regressão de Render — {html.escape(cenario_id)}</title>
</head><body style="margin:24px;background:#0b0b0e;color:#f1f5f9;font-family:system-ui,sans-serif">
<h1>Cenário: <code>{html.escape(cenario_id)}</code> — {status_txt}</h1>
<p>Perfil: <strong>{perfil}</strong></p>
{aviso_env}
<pre style="padding:12px;background:#141418;border:1px solid #2b2b33;border-radius:8px;overflow:auto">{html.escape(json.dumps(resultado.get("resumo") or resultado, ensure_ascii=False, indent=2, default=str))}</pre>
{''.join(linhas_html)}
</body></html>
"""
    html_path = pasta / "index.html"
    html_path.write_text(pagina, encoding="utf-8")
    return html_path
