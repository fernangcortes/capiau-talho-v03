"""Auditoria de cor do acervo -- Fase 0.4 de docs/PLANO_COR_OCIO.md.

O que faz: le as tags de cor de cada midia (original E proxy), grava nas colunas
novas da Fase 0.2 e imprime o mapa de cor do acervo inteiro. NAO decodifica
quadro nenhum, NAO escreve arquivo nenhum, NAO muda pixel nenhum.

Por que existe: hoje nada no banco sabe em que convencao de cor cada arquivo
esta. Medido em 24/08/2026, antes desta auditoria existir:

    41 proxies -> yuv420p, sem tag nenhuma   (range limitado implicito)
    10 proxies -> yuvj420p, range 'pc', bt709 (full range declarado)

Os dois convivem no mesmo projeto e na mesma timeline. Nao ha bug de niveis
(original x proxy bate dentro de 0,4/255 -- foi medido), mas o estado nao e
declarado em lugar nenhum: no dia em que um encoder novo, um navegador ou o
libplacebo adivinhar diferente, quebra em silencio e nao ha onde olhar. Este
script e o "onde olhar".

CUSTO (medido no acervo real, 541 videos + 541 proxies + 1424 fotos):
    serial     ~158 ms/arquivo  ->  ~3 min
    8 threads   ~20 ms/arquivo  ->  ~30 s
O gargalo e spawn de processo do Windows, nao disco -- por isso paralelizar
rende 8x. Custo unico: depois disto, midia nova ja entra auditada pela
ingestao, e reauditar vira SELECT.

Uso:
    python scripts/auditar_cor.py                  # audita tudo e grava
    python scripts/auditar_cor.py --so-relatorio   # nao grava, so mostra
    python scripts/auditar_cor.py --projeto 2
    python scripts/auditar_cor.py --workers 16
"""
import argparse
import collections
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.color import deteccao
from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.db.schema import init_db
from src.media.ffmpeg import get_media_metadata

AUSENTE = "<sem tag>"


# ---------------------------------------------------------------------------
# Coleta (roda em threads: so subprocess e leitura de cabecalho, nada de SQLite)
# ---------------------------------------------------------------------------

def _auditar_video(linha) -> dict:
    """Le original e proxy de um video. Nunca levanta -- erro vira campo."""
    vid = linha["id"]
    resultado = {"id": vid, "filename": linha["filename"], "erro": None,
                 "original_ok": False, "proxy_ok": False, "dados": {}}

    caminho = linha["filepath"]
    if caminho and os.path.exists(caminho):
        try:
            meta = get_media_metadata(Path(caminho))
            resultado["dados"].update(deteccao.resolver(meta))
            resultado["entrelacado"] = deteccao.e_entrelacado(meta)
            resultado["range_efetivo"] = deteccao.resolver_range(meta)
            resultado["original_ok"] = True
        except Exception as e:
            resultado["erro"] = f"original: {e}"

    proxy = CONFIG.PROXIES_DIR / f"proxy_vid_{vid}.mp4"
    if proxy.exists():
        try:
            pmeta = get_media_metadata(proxy)
            resultado["dados"]["proxy_color_range"] = pmeta.get("color_range")
            resultado["dados"]["proxy_pix_fmt"] = pmeta.get("pix_fmt")
            resultado["proxy_range_efetivo"] = deteccao.resolver_range(pmeta)
            resultado["proxy_ok"] = True
        except Exception as e:
            resultado["erro"] = f"{resultado['erro'] or ''} proxy: {e}".strip()

    return resultado


def _auditar_foto(linha) -> dict:
    vid = linha["id"]
    resultado = {"id": vid, "filename": linha["filename"], "erro": None,
                 "original_ok": False, "dados": {}}
    caminho = linha["filepath"]
    if caminho and os.path.exists(caminho):
        try:
            resultado["dados"] = deteccao.resolver_foto(caminho)
            resultado["original_ok"] = True
        except Exception as e:
            resultado["erro"] = str(e)
    return resultado


def _coletar(linhas, fn, workers: int, rotulo: str) -> list:
    if not linhas:
        return []
    inicio = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        saida = list(ex.map(fn, linhas))
    dur = time.perf_counter() - inicio
    print(f"  {rotulo}: {len(linhas)} em {dur:.1f}s ({dur / len(linhas) * 1000:.0f} ms/arquivo)")
    return saida


# ---------------------------------------------------------------------------
# Relatorio
# ---------------------------------------------------------------------------

def _tabela(titulo: str, contador: collections.Counter, total: int) -> None:
    print(f"\n  {titulo}")
    if not contador:
        print("    (nada)")
        return
    largura = max(len(str(k)) for k in contador) + 2
    for chave, n in contador.most_common():
        pct = n / total * 100 if total else 0.0
        print(f"    {str(chave):<{largura}} {n:>5}  ({pct:4.1f}%)")


def _relatorio_videos(resultados: list) -> None:
    total = len(resultados)
    print(f"\n{'=' * 70}\nVIDEOS ({total})\n{'=' * 70}")

    inacessiveis = [r for r in resultados if not r["original_ok"]]
    sem_proxy = [r for r in resultados if not r["proxy_ok"]]
    legiveis = [r for r in resultados if r["original_ok"]]

    if inacessiveis:
        print(f"\n  ! {len(inacessiveis)} originais inacessiveis (HD desconectado?) "
              f"-- nao auditados")
    if sem_proxy:
        print(f"  ! {len(sem_proxy)} sem proxy no disco")

    _tabela("Perfil de cor (original)",
            collections.Counter(r["dados"].get("color_profile") for r in legiveis), len(legiveis))
    _tabela("Origem do perfil  ('ausente' = o arquivo nao declarou nada)",
            collections.Counter(r["dados"].get("color_profile_origem") for r in legiveis), len(legiveis))
    _tabela("Tag color_range no ORIGINAL",
            collections.Counter(r["dados"].get("color_range") or AUSENTE for r in legiveis), len(legiveis))
    _tabela("Range EFETIVO do original (tag, ou pix_fmt quando ausente)",
            collections.Counter(f"{r['range_efetivo'][0]}  (por {r['range_efetivo'][1]})"
                                for r in legiveis if r.get("range_efetivo")), len(legiveis))

    com_proxy = [r for r in resultados if r["proxy_ok"]]
    _tabela("PROXY: pix_fmt + tag de range",
            collections.Counter(
                f"{r['dados'].get('proxy_pix_fmt')}  range={r['dados'].get('proxy_color_range') or AUSENTE}"
                for r in com_proxy), len(com_proxy))

    # A pergunta que motivou o plano: o proxy conserva a convencao do original?
    pares = [r for r in resultados if r["original_ok"] and r["proxy_ok"]
             and r.get("range_efetivo") and r.get("proxy_range_efetivo")]
    divergentes = [r for r in pares if r["range_efetivo"][0] != r["proxy_range_efetivo"][0]]
    print(f"\n  Coerencia original -> proxy: {len(pares) - len(divergentes)}/{len(pares)} "
          f"mantem o mesmo range efetivo")
    if divergentes:
        print(f"    ! {len(divergentes)} divergem:")
        for r in divergentes[:10]:
            print(f"      {r['filename'][:44]:<46} "
                  f"{r['range_efetivo'][0]} -> {r['proxy_range_efetivo'][0]}")
        if len(divergentes) > 10:
            print(f"      ... e mais {len(divergentes) - 10}")

    entrelacados = [r for r in legiveis if r.get("entrelacado")]
    if entrelacados:
        print(f"\n  ! {len(entrelacados)} videos ENTRELACADOS (field_order) e o proxy nao "
              f"desentrelaca.\n    Fora do escopo do plano de cor -- ver secao 9 de "
              f"docs/PLANO_COR_OCIO.md.")


def _relatorio_fotos(resultados: list) -> None:
    total = len(resultados)
    print(f"\n{'=' * 70}\nFOTOS ({total})\n{'=' * 70}")
    legiveis = [r for r in resultados if r["original_ok"]]
    inacessiveis = total - len(legiveis)
    if inacessiveis:
        print(f"\n  ! {inacessiveis} inacessiveis -- nao auditadas")

    _tabela("Perfil de cor", collections.Counter(
        r["dados"].get("color_profile") for r in legiveis), len(legiveis))

    n_raw = sum(1 for r in legiveis if r["dados"].get("color_profile") == "raw")
    if n_raw:
        print(f"\n  {n_raw} fotos RAW: a cor final NAO esta no arquivo, e decidida pelo")
        print(f"  rawpy em src/media/image_processing.py -- que hoje roda com os DEFAULTS,")
        print(f"  incluindo no_auto_bright=False (auto-brilho ligado, clipando 1% dos")
        print(f"  pixels, foto a foto). E o item 1.2 do plano.")


# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Auditoria de cor do acervo (Fase 0).")
    parser.add_argument("--projeto", type=int, default=None, help="limita a um projeto")
    parser.add_argument("--workers", type=int, default=8, help="threads de leitura (default 8)")
    parser.add_argument("--so-relatorio", action="store_true",
                        help="nao grava no banco; so imprime o mapa")
    parser.add_argument("--so-videos", action="store_true")
    parser.add_argument("--so-fotos", action="store_true")
    args = parser.parse_args()

    # Garante que as colunas da Fase 0.2 existem antes de tentar gravar nelas.
    init_db()

    filtro = "WHERE project_id = ?" if args.projeto else ""
    params = (args.projeto,) if args.projeto else ()

    with get_db() as conn:
        videos = [] if args.so_fotos else conn.execute(
            f"SELECT id, filename, filepath FROM video {filtro} ORDER BY id", params).fetchall()
        fotos = [] if args.so_videos else conn.execute(
            f"SELECT id, filename, filepath FROM photo {filtro} ORDER BY id", params).fetchall()

    print(f"Auditando {len(videos)} videos e {len(fotos)} fotos "
          f"com {args.workers} threads...")
    inicio = time.perf_counter()

    res_videos = _coletar(videos, _auditar_video, args.workers, "videos + proxies")
    res_fotos = _coletar(fotos, _auditar_foto, args.workers, "fotos")

    if not args.so_relatorio:
        gravados = 0
        with get_db() as conn:
            for r in res_videos:
                if r["dados"] and MediaRepository.update_video_color(conn, r["id"], r["dados"]):
                    gravados += 1
            for r in res_fotos:
                if r["dados"] and MediaRepository.update_photo_color(conn, r["id"], r["dados"]):
                    gravados += 1
        print(f"  gravadas {gravados} linhas no banco")
    else:
        print("  (--so-relatorio: nada gravado)")

    if res_videos:
        _relatorio_videos(res_videos)
    if res_fotos:
        _relatorio_fotos(res_fotos)

    erros = [r for r in res_videos + res_fotos if r["erro"]]
    if erros:
        print(f"\n{'=' * 70}\n{len(erros)} ERROS de leitura\n{'=' * 70}")
        for r in erros[:15]:
            print(f"  {r['filename'][:44]:<46} {r['erro']}")
        if len(erros) > 15:
            print(f"  ... e mais {len(erros) - 15}")

    print(f"\nTotal: {time.perf_counter() - inicio:.1f}s")


if __name__ == "__main__":
    main()
