"""Bancada da camada 2 do áudio (docs/PLANO_AUDIO_CATEGORIAS.md, seção 6). Só leitura.

Junte exemplos em subpastas com o nome da categoria esperada:

    D:\\calibrar_audio\\efeito\\porta.wav
    D:\\calibrar_audio\\room_tone\\sala_cozinha.wav
    D:\\calibrar_audio\\ambiente\\rua.wav ...

e rode:

    .venv\\Scripts\\python scripts\\audio_calibrar.py D:\\calibrar_audio

Mostra, por arquivo, o que o som decidiu SEM a dica do nome (o nome da subpasta
daria a resposta) e os sinais medidos; no fim, o acerto por categoria. Não grava
nada no banco. `--json saida.json` guarda os sinais para ajustar os limiares de
src/media/audio_classificador.py.
"""
import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.media import audio_classificador as AC  # noqa: E402
from src.media.ffmpeg import get_media_metadata  # noqa: E402
from src.nlp.prompt_registry import AUDIO_CATEGORIES  # noqa: E402

EXTENSOES = {".wav", ".mp3", ".m4a", ".bwf", ".aif", ".aiff", ".flac", ".mp4", ".mov", ".mts", ".mxf"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pasta", type=Path)
    ap.add_argument("--json", type=Path, help="grava os sinais de cada arquivo")
    args = ap.parse_args()

    motor = AC.carregar_motor()
    linhas, acertos, totais, confusao = [], Counter(), Counter(), defaultdict(Counter)
    for arquivo in sorted(p for p in args.pasta.rglob("*") if p.suffix.lower() in EXTENSOES):
        esperado = arquivo.parent.name.lower().replace(" ", "_")
        if esperado not in AUDIO_CATEGORIES:
            print(f"  (pulado: subpasta '{arquivo.parent.name}' não é categoria de áudio) {arquivo.name}")
            continue
        duracao = get_media_metadata(arquivo)["duration"]
        m = AC.medir(arquivo, duracao, motor)
        r = AC.decidir(m, motor.rotulos)  # sem caminho: só o som
        totais[esperado] += 1
        acertos[esperado] += r.categoria == esperado
        confusao[esperado][r.categoria] += 1
        marca = "ok " if r.categoria == esperado else "ERR"
        s = r.sinais
        print(f"{marca} {esperado:10} -> {r.categoria:10} {r.confianca:.2f}  {arquivo.name[:40]:40} "
              f"fala {s['frac_fala']:.2f} mús {s['frac_musica']:.2f} nível {s['nivel_mediana_db']:6.1f} "
              f"±{s['nivel_desvio_db']:4.1f} dB {s['duracao_s']:7.1f}s  {', '.join(s['classes_topo'][:3])}")
        linhas.append({"arquivo": str(arquivo), "esperado": esperado, "categoria": r.categoria,
                       "confianca": r.confianca, "sinais": s})

    print("\nAcerto por categoria (só o som):")
    for cat in AUDIO_CATEGORIES:
        if totais[cat]:
            erros = ", ".join(f"{k} {v}" for k, v in confusao[cat].items() if k != cat)
            print(f"  {cat:10} {acertos[cat]}/{totais[cat]}" + (f"  (virou: {erros})" if erros else ""))
    if args.json:
        args.json.write_text(json.dumps(linhas, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
