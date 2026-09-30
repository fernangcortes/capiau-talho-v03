"""Compara motores de transcrição nos mesmos clipes, sem gravar no banco.

Para cada clipe extrai o áudio uma vez, roda cada motor pedido e mostra tempo,
número de palavras, falantes distintos e a diferença de palavras (WER) contra
o motor de referência (o primeiro da lista). Os textos ficam em
data/cache/asr_comparacao/<video_id>_<motor>.json para ler depois.

Uso:
    set PYTHONPATH=. && .venv\\Scripts\\python.exe scripts\\asr_comparar.py --ids 517,99 --motores assemblyai_universal_35,deepgram_nova_3
    (--ids some: pega --n clipes transcritos de --project com duração entre 30 s e 3 min)
"""
import argparse
import json
import re
import time
import unicodedata
from pathlib import Path

from src.config import CONFIG
from src.db.connection import get_db
from src.media.ffmpeg import extract_audio_mono
from src.services.settings_service import SettingsService
from src.transcription.motores import CHAVE_DO_MOTOR, ErroASR, OpcoesASR, resolver_motores, transcrever

SAIDA = CONFIG.CACHE_DIR / "asr_comparacao"


def normalizar(texto: str) -> list:
    texto = unicodedata.normalize("NFKD", texto.lower())
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.findall(r"[a-z0-9]+", texto)


def wer(referencia: list, hipotese: list) -> float:
    """Distância de edição por palavra dividida pelo tamanho da referência."""
    if not referencia:
        return 0.0 if not hipotese else 1.0
    anterior = list(range(len(hipotese) + 1))
    for i, r in enumerate(referencia, 1):
        atual = [i] + [0] * len(hipotese)
        for j, h in enumerate(hipotese, 1):
            atual[j] = min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (r != h))
        anterior = atual
    return anterior[-1] / len(referencia)


def selecionar(project_id: int, n: int) -> list:
    with get_db() as conn:
        linhas = conn.execute(
            "SELECT v.id FROM video v WHERE v.project_id = ? AND v.duration BETWEEN 30 AND 180 "
            "AND (SELECT count(*) FROM transcript t WHERE t.video_id = v.id) > 40 ORDER BY v.id LIMIT ?",
            (project_id, n)).fetchall()
    return [r["id"] for r in linhas]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--project", type=int, default=2)
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--motores", default="assemblyai_universal_35,deepgram_nova_3")
    args = ap.parse_args()

    ids = [int(x) for x in args.ids.split(",") if x.strip()] or selecionar(args.project, args.n)
    motores = [m.strip() for m in args.motores.split(",") if m.strip()]
    SAIDA.mkdir(parents=True, exist_ok=True)
    totais = {m: {"segundos": 0.0, "wer": [], "falhas": 0} for m in motores}

    for vid in ids:
        with get_db() as conn:
            v = conn.execute("SELECT filepath, duration, project_id FROM video WHERE id = ?", (vid,)).fetchone()
        if not v:
            print(f"#{vid}: não existe")
            continue
        S = SettingsService.get_settings(v["project_id"])
        audio = SAIDA / f"{vid}.mp3"
        if not audio.exists() and not extract_audio_mono(Path(v["filepath"]), audio):
            print(f"#{vid}: não consegui extrair o áudio")
            continue
        print(f"\n#{vid} ({v['duration']:.0f} s)")
        opcoes = OpcoesASR(idioma=S.get("asr.language"), diarizar=True,
                           max_falantes=S.get("diarization.max_speakers"), detectar_entidades=False)
        referencia = None
        for motor in motores:
            plano = resolver_motores(motor, "mesmo_motor")
            if plano.transcricao != motor:
                print(f"  {motor:<26} não ligado ainda")
                totais[motor]["falhas"] += 1
                continue
            provedor = CHAVE_DO_MOTOR.get(motor)
            t0 = time.perf_counter()
            try:
                r = transcrever(audio, plano, opcoes, S.api_key(provedor) if provedor else None)
            except (ErroASR, Exception) as e:
                print(f"  {motor:<26} FALHOU: {e}")
                totais[motor]["falhas"] += 1
                continue
            dt = time.perf_counter() - t0
            texto = " ".join(p["word"] for p in r.palavras)
            (SAIDA / f"{vid}_{motor}.json").write_text(
                json.dumps({"motor": motor, "modelo": r.modelo_usado, "segundos": dt, "palavras": r.palavras},
                           ensure_ascii=False, indent=1), encoding="utf-8")
            falantes = len({p["speaker_id"] for p in r.palavras})
            linha = f"  {motor:<26} {dt:6.1f} s  {len(r.palavras):4d} palavras  {falantes} falante(s)"
            if referencia is None:
                referencia = normalizar(texto)
                linha += "  (referência)"
            else:
                w = wer(referencia, normalizar(texto))
                totais[motor]["wer"].append(w)
                linha += f"  WER {w:.0%}"
            totais[motor]["segundos"] += dt
            print(linha + f"  [{r.modelo_usado or '?'}]")
            print(f"    {texto[:110]}")

    print("\nResumo (WER contra o primeiro motor, não contra um gabarito humano)")
    for m, t in totais.items():
        media = f"WER médio {sum(t['wer']) / len(t['wer']):.0%}" if t["wer"] else ""
        print(f"  {m:<26} tempo total {t['segundos']:6.1f} s  falhas {t['falhas']}  {media}")


if __name__ == "__main__":
    main()
