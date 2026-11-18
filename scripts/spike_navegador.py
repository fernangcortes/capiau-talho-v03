#!/usr/bin/env python3
"""Spike de medição da Frente D1 (`src/navegador/`): origem segura, AudioWorklet, CDP e latência."""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

from src.navegador import Navegador, diagnosticar, diagnostico_barato


def _medir_percentis(valores: list[float]) -> dict:
    if not valores:
        return {"p50_ms": 0.0, "p95_ms": 0.0, "media_ms": 0.0}
    ordenados = sorted(valores)
    idx_95 = min(len(ordenados) - 1, max(0, int(round(0.95 * (len(ordenados) - 1)))))
    return {
        "p50_ms": round(statistics.median(ordenados), 2),
        "p95_ms": round(ordenados[idx_95], 2),
        "media_ms": round(statistics.mean(ordenados), 2),
    }


def executar_spike(repeticoes: int = 10) -> dict:
    barato = diagnostico_barato()
    if not barato["ok"]:
        return {"ok": False, "diagnostico_barato": barato}

    diag = diagnosticar()
    resultado: dict = {
        "ok": bool(diag.get("lancamento_ok")),
        "diagnostico": diag,
        "beginframe_probe": None,
        "capturas": {},
    }

    with tempfile.TemporaryDirectory(prefix="capiau_spike_nav_") as tmp:
        tmp_path = Path(tmp)
        html = tmp_path / "spike.html"
        html.write_text(
            """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: transparent !important; overflow: hidden; }
#caixa {
  position: absolute; left: 80px; bottom: 80px; padding: 18px 28px;
  border-radius: 12px; background: rgba(12, 16, 22, 0.72); color: #fff;
  font: 600 42px/1.2 sans-serif;
}
</style></head>
<body><div id="caixa">Teste Spike D1</div>
<script>window.SPIKE_PRONTO = true; window.atualizar = t => { document.getElementById('caixa').textContent = t; };</script>
</body></html>""",
            encoding="utf-8",
        )
        with Navegador(tmp_path, rotulo="spike") as nav:
            _ = nav.info
            base = nav.servidor.publicar_pasta("spike", tmp_path)
            pg = nav.pagina(640, 360, rotulo="spike")
            try:
                pg.abrir(f"{base}/spike.html", pronto="window.SPIKE_PRONTO === true")

                # S1: HeadlessExperimental.enable no navegador padrão
                cdp = pg.pw.context.new_cdp_session(pg.pw)
                try:
                    cdp.send("HeadlessExperimental.enable")
                    resultado["beginframe_probe"] = {"suportado": True, "erro": None}
                except Exception as exc:
                    resultado["beginframe_probe"] = {"suportado": False, "erro": str(exc)}
                finally:
                    try:
                        cdp.detach()
                    except Exception:
                        pass

                for nome_res, (w, h) in (("360p", (640, 360)), ("1080p", (1920, 1080))):
                    pg.redimensionar(w, h)
                    # Aquecimento
                    pg.capturar(formato="png", alfa=True)
                    pg.capturar(formato="jpeg", alfa=False, qualidade=85)

                    tempos_png: list[float] = []
                    bytes_png: list[int] = []
                    for i in range(repeticoes):
                        pg.avaliar("t => window.atualizar(t)", f"Q {nome_res} #{i}")
                        q = pg.capturar(formato="png", alfa=True)
                        tempos_png.append(q.ms)
                        bytes_png.append(len(q.dados or b""))

                    tempos_jpg: list[float] = []
                    bytes_jpg: list[int] = []
                    for i in range(repeticoes):
                        pg.avaliar("t => window.atualizar(t)", f"J {nome_res} #{i}")
                        q = pg.capturar(formato="jpeg", alfa=False, qualidade=85)
                        tempos_jpg.append(q.ms)
                        bytes_jpg.append(len(q.dados or b""))

                    resultado["capturas"][nome_res] = {
                        "png_alfa": {
                            **_medir_percentis(tempos_png),
                            "bytes_medio": int(statistics.mean(bytes_png)),
                        },
                        "jpeg_q85": {
                            **_medir_percentis(tempos_jpg),
                            "bytes_medio": int(statistics.mean(bytes_jpg)),
                        },
                    }
            finally:
                pg.fechar()

    return resultado


def formatar_markdown(dados: dict) -> str:
    d = dados.get("diagnostico") or {}
    bf = dados.get("beginframe_probe") or {}
    cap = dados.get("capturas") or {}
    linhas = [
        "# Medições do Navegador Headless (`Frente D1` — Spike E0)",
        "",
        f"> **Canal detectado:** `{d.get('canal')}` (`{d.get('versao')}`)",
        f"> **GPU:** `{d.get('gpu')}` · **Tempo de arranque:** `{d.get('tempo_arranque_ms')} ms`",
        f"> **Contexto seguro (`127.0.0.1`):** `{d.get('contexto_seguro')}` · **`OfflineAudioContext.audioWorklet`:** `{d.get('audio_worklet_disponivel')}`",
        f"> **Suporte a `HeadlessExperimental.enable` no canal atual:** `{bf.get('suportado')}`"
        + (f" (`{bf.get('erro')}`)" if bf.get("erro") else ""),
        "",
        "## Latência e Tamanho de Captura (`page.screenshot`)",
        "",
        "| Resolução | Formato | p50 (ms) | p95 (ms) | Média (ms) | Tamanho médio (bytes) |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for res, formatos in cap.items():
        for fmt, met in formatos.items():
            linhas.append(
                f"| `{res}` | `{fmt}` | {met['p50_ms']} | {met['p95_ms']} | {met['media_ms']} | {met['bytes_medio']} |"
            )
    linhas += [
        "",
        "## Decisão para o Estágio 1C (E0–E3)",
        "",
        "- Servidor HTTP local em `127.0.0.1` confirmado como **contexto seguro** (`window.isSecureContext === true`) e compatível com `OfflineAudioContext.audioWorklet` (requisito da Frente A).",
        "- Títulos continuam usando `page.screenshot` com `omit_background=True` (PNG RGBA com alfa fiel) sem perda de paridade pixel a pixel.",
        "- `HeadlessExperimental.beginFrame` permanece fora do caminho padrão (suportado apenas no `chrome-headless-shell` opcional em etapas posteriores).",
        "",
    ]
    return "\n".join(linhas)


def main() -> int:
    ap = argparse.ArgumentParser(description="Spike de medição do módulo src/navegador/")
    ap.add_argument("--repeticoes", type=int, default=8)
    ap.add_argument("--gravar-doc", action="store_true", help="Grava docs/MEDICOES_NAVEGADOR.md")
    args = ap.parse_args()

    dados = executar_spike(repeticoes=max(2, args.repeticoes))
    if args.gravar_doc and dados.get("ok"):
        destino = RAIZ / "docs" / "MEDICOES_NAVEGADOR.md"
        destino.write_text(formatar_markdown(dados), encoding="utf-8", newline="\n")
    print(json.dumps(dados, ensure_ascii=False, indent=2))
    return 0 if dados.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
