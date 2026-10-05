"""Roda DENTRO do .venv-nemo (transformers >= 5.18), chamado como processo à parte.

O .venv principal tem transformers 5.15, que não conhece o Nemotron 3
Diarization nem o Canary; atualizar lá arriscaria a Laya e o resto. Por isso
este arquivo só usa a biblioteca padrão, torch e transformers, e não importa
nada de ``src``.

Uso (o lado de cá está em src/transcription/motores.py):
    python venv_nemo_worker.py diarizar <audio.wav> <saida.json>
Saída: {"modelo": ..., "segmentos": [{"inicio": s, "fim": s, "falante": n}, ...]}
"""
import json
import sys
import time

NEMOTRON = "nvidia/Nemotron-3-Diarization"


def diarizar(audio_path: str) -> dict:
    import torch
    from transformers import AutoModelForAudioFrameClassification, AutoProcessor
    from transformers.audio_utils import load_audio

    t0 = time.perf_counter()
    proc = AutoProcessor.from_pretrained(NEMOTRON)
    model = AutoModelForAudioFrameClassification.from_pretrained(NEMOTRON)
    model.eval()
    carga = time.perf_counter() - t0

    sr = proc.feature_extractor.sampling_rate
    audio = load_audio(audio_path, sampling_rate=sr)
    t0 = time.perf_counter()
    inputs = proc(audio, sampling_rate=sr)
    with torch.inference_mode():
        logits = model(**inputs).logits
    segmentos = proc.extract_speaker_dict(logits, inputs.attention_mask)[0]
    return {
        "modelo": NEMOTRON,
        "carga_s": round(carga, 2),
        "inferencia_s": round(time.perf_counter() - t0, 2),
        "segmentos": [{"inicio": float(s["Start"]), "fim": float(s["End"]), "falante": int(s["Speaker"])}
                      for s in segmentos],
    }


def main(argv):
    if len(argv) != 4 or argv[1] not in ("diarizar",):
        print(__doc__, file=sys.stderr)
        return 2
    resultado = diarizar(argv[2])
    with open(argv[3], "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
