"""Relatório HTML do teste de planos-sequência (scripts/plano_sequencia_teste.py).

Toca os proxies e mostra, numa linha do tempo por vídeo, a escala e o movimento que o modelo
de visão deu para cada trecho, ao lado do que o Talho já faz hoje sem API (escala por CLIP,
movimento por fluxo óptico). Junta trechos vizinhos em "trechos sugeridos" (a subdivisão do
plano-sequência). A revisão por trecho fica no navegador e sai num JSON. Mesmo estilo de
scripts/triagem_relatorio.html (o CSS vem de lá).

Abrir pelo servidor com Range (scripts/servir_relatorios.py), senão o vídeo não pula:
    http://127.0.0.1:8771/cache/plano_sequencia/teste_<data>.html

Uso:
    .venv\\Scripts\\python.exe scripts\\plano_sequencia_teste_relatorio.py [teste_<data>.json]
    (sem argumento: o teste mais recente)
"""
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import CONFIG  # noqa: E402

PASTA = CONFIG.CACHE_DIR / "plano_sequencia"
AQUI = Path(__file__).resolve().parent


def _relativo(arquivo: Path, base: Path) -> str:
    try:
        return quote(os.path.relpath(arquivo, base).replace(os.sep, "/"))
    except ValueError:
        return arquivo.as_uri()


def gerar(caminho: Path) -> Path:
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    for v in dados["videos"]:
        proxy = CONFIG.PROXIES_DIR / f"proxy_vid_{v['id']}.mp4"
        v["video"] = _relativo(proxy, caminho.parent) if proxy.exists() else None
    base = (AQUI / "triagem_relatorio.html").read_text(encoding="utf-8")
    css = base[base.index("<style>"):base.index("</style>") + 8]
    modelo = (AQUI / "plano_sequencia_teste_relatorio.html").read_text(encoding="utf-8")
    bruto = json.dumps(dados, ensure_ascii=False).replace("</", "<\\/")
    destino = caminho.with_suffix(".html")
    destino.write_text(modelo.replace("<!--CSS-->", css).replace("/*__DADOS__*/null", bruto), encoding="utf-8")
    return destino


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv:
        alvo = Path(argv[0]).resolve()
    else:
        testes = sorted(PASTA.glob("teste_*.json"))
        if not testes:
            raise SystemExit("Nenhum teste em " + str(PASTA))
        alvo = testes[-1]
    destino = gerar(alvo)
    print(f"Relatório: {destino}")
    print(f"Abra em: http://127.0.0.1:8771/{destino.relative_to(CONFIG.DB_PATH.parent).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
