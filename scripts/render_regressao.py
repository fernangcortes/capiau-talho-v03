#!/usr/bin/env python3
"""CLI do harness de regressão do render (`tests/render_regressao/`)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

from tests.render_regressao import fontes, referencias


def _forcar_cpu_cli() -> None:
    import src.media.ffmpeg as ff

    ff.get_hardware_settings = lambda *_a, **_kw: ("cpu", "none")  # type: ignore[assignment]


def main() -> int:
    ap = argparse.ArgumentParser(description="CLI do harness de regressão do render (Frente B)")
    sub = ap.add_subparsers(dest="comando", required=True)

    sub.add_parser("ambiente", help="Mostra a impressão digital do ambiente local")

    p_midia = sub.add_parser("midia", help="Gera mídias sintéticas versionadas em tests/render_regressao/midia/")
    p_midia.add_argument("--forcar", action="store_true", help="Regenera mesmo se já existirem")

    p_gerar = sub.add_parser("gerar", help="Renderiza candidata(s) e grava em _saida/")
    p_gerar.add_argument("--cenario", default="todos", help="ID do cenário ou 'todos'")

    p_rel = sub.add_parser("relatorio", help="Mostra caminho e resumo do último relatório em _saida/")
    p_rel.add_argument("--cenario", required=True)

    p_apr = sub.add_parser("aprovar", help="Promove candidata de _saida/ para referencias/")
    p_apr.add_argument("--cenario", required=True)
    p_apr.add_argument("--motivo", required=True)
    p_apr.add_argument("--sim", action="store_true", help="Confirma sem prompt interativo")

    sub.add_parser("migrar", help="Migra schema de cenários em cenarios/")

    args = ap.parse_args()

    if args.comando == "ambiente":
        print(json.dumps(referencias.impressao_digital_ambiente(), ensure_ascii=False, indent=2))
        return 0

    if args.comando == "midia":
        mapa = fontes.garantir_midias_sinteticas(forcar=bool(args.forcar))
        tamanhos = {k: v.stat().st_size for k, v in mapa.items()}
        print(json.dumps({"total_bytes": sum(tamanhos.values()), "arquivos": tamanhos}, ensure_ascii=False, indent=2))
        return 0

    if args.comando == "gerar":
        _forcar_cpu_cli()
        alvos = (
            [c["id"] for c in referencias.listar_cenarios()]
            if args.cenario == "todos"
            else [args.cenario]
        )
        res = [referencias.gerar_candidata(cid) for cid in alvos]
        print(json.dumps(res, ensure_ascii=False, indent=2, default=str))
        return 0

    if args.comando == "relatorio":
        pasta = referencias.pasta_candidata(args.cenario)
        html_p = pasta / "index.html"
        res_p = pasta / "resultado.json"
        if not res_p.is_file():
            print(f"Nenhum resultado em {pasta}. Execute `gerar --cenario {args.cenario}`.", file=sys.stderr)
            return 1
        print(f"HTML: {html_p}")
        print(res_p.read_text(encoding="utf-8"))
        return 0

    if args.comando == "aprovar":
        with referencias.autorizar_escrita_referencias():
            res = referencias.aprovar_candidata(args.cenario, motivo=args.motivo, sim=bool(args.sim))
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0 if res.get("aprovado") else 1

    if args.comando == "migrar":
        alterados = referencias.migrar_cenarios()
        print(json.dumps({"alterados": alterados}, ensure_ascii=False, indent=2))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
