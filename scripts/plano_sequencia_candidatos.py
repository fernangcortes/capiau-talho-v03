"""Player HTML dos candidatos a plano-sequência, para escolher os clipes do teste local.

Lê as medidas de scripts/plano_sequencia_medir.py e o banco (só leitura), tira 12 quadros de
cada proxy (tira clicável que pula o vídeo) e gera um HTML que toca os proxies direto do disco,
no mesmo estilo de scripts/triagem_relatorio.html. A escolha fica no navegador e sai num JSON
pelo botão "Baixar escolha".

Uso:
    .venv\\Scripts\\python.exe scripts\\plano_sequencia_candidatos.py [ids separados por vírgula]
    (padrão: os 10 escolhidos em 07/10/2026)
"""
import json
import os
import sqlite3
import sys
from pathlib import Path
from urllib.parse import quote

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import CONFIG  # noqa: E402

PASTA = CONFIG.CACHE_DIR / "plano_sequencia"
PADRAO = [545, 240, 179, 232, 321, 546, 388, 423, 518, 306]
SUGERIDOS = [545, 321, 546, 179]
N_QUADROS = 12


def _relativo(arquivo: Path, base: Path) -> str:
    try:
        return quote(os.path.relpath(arquivo, base).replace(os.sep, "/"))
    except ValueError:  # outro disco: não há caminho relativo
        return arquivo.as_uri()


def _quadros(proxy: Path, duracao: float, vid: int) -> list:
    pasta = PASTA / "quadros"
    pasta.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(proxy))
    saida = []
    for j in range(N_QUADROS):
        t = duracao * (j + 0.5) / N_QUADROS
        destino = pasta / f"v{vid}_{j:02d}.jpg"
        if not destino.exists():
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, f = cap.read()
            if not ok:
                continue
            cv2.imwrite(str(destino), cv2.resize(f, (320, 180)), [cv2.IMWRITE_JPEG_QUALITY, 80])
        saida.append({"t": round(t, 1), "img": _relativo(destino, PASTA)})
    cap.release()
    return saida


def coletar(ids) -> dict:
    medidas = {m["id"]: m for m in json.loads((PASTA / "medidas.json").read_text(encoding="utf-8"))}
    conn = sqlite3.connect(f"file:{CONFIG.DB_PATH.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    clipes = []
    for vid in ids:
        v = conn.execute("SELECT * FROM video WHERE id = ?", (vid,)).fetchone()
        m = medidas.get(vid, {})
        proxy = CONFIG.PROXIES_DIR / f"proxy_vid_{vid}.mp4"
        palavras = conn.execute("SELECT COUNT(*) FROM transcript WHERE video_id = ?", (vid,)).fetchone()[0]
        clipes.append({
            "id": vid, "arquivo": v["filename"], "caminho": v["filepath"], "duracao": v["duration"],
            "titulo": v["title"], "descricao": v["description"], "categoria": v["category"],
            "gravado": v["recorded_at"], "resolucao": v["resolution"],
            "palavras_min": round(palavras / (v["duration"] / 60)) if v["duration"] else None,
            "movimento": m.get("moving"), "deriva": m.get("deriva10"), "saltos": m.get("saltos"),
            "escuro": m.get("escuro"), "nota": m.get("score"), "sugerido": vid in SUGERIDOS,
            "video": _relativo(proxy, PASTA) if proxy.exists() else None,
            "quadros": _quadros(proxy, v["duration"], vid) if proxy.exists() else [],
        })
    conn.close()
    return {"gerado_em": __import__("datetime").datetime.now().isoformat(timespec="minutes"),
            "medidos": len(medidas), "clipes": clipes}


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    ids = [int(x) for x in argv[0].split(",")] if argv else PADRAO
    dados = coletar(ids)
    modelo = Path(__file__).with_name("plano_sequencia_candidatos.html").read_text(encoding="utf-8")
    bruto = json.dumps(dados, ensure_ascii=False).replace("</", "<\\/")
    destino = PASTA / "candidatos.html"
    destino.write_text(modelo.replace("/*__DADOS__*/null", bruto), encoding="utf-8")
    print(f"Player: {destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
