"""Roda DENTRO do .venv-nemo (transformers >= 5.18), chamado como processo à parte.

O .venv principal tem transformers 5.15, que não conhece o Nemotron 3
Diarization; atualizar lá arriscaria a Laya e o resto. O Canary roda pelo
NeMo, porque só ele devolve tempo por palavra (pelo transformers sai só texto).
Este arquivo não importa nada de ``src``.

Uso (o lado de cá está em src/transcription/motores.py):
    python venv_nemo_worker.py diarizar <audio.wav> <saida.json>
    python venv_nemo_worker.py canary <audio.wav> <saida.json> <idioma>
Saídas:
    diarizar: {"modelo", "segmentos": [{"inicio": s, "fim": s, "falante": n}, ...]}
    canary:   {"modelo", "palavras": [{"word", "start", "end"}, ...]}
"""
import json
import os
import sys
import tarfile
import time

NEMOTRON = "nvidia/Nemotron-3-Diarization"
CANARY_REPO, CANARY_ARQUIVO = "nvidia/canary-1b-v2", "canary-1b-v2.nemo"
# O NeMo descompacta o .nemo (6,4 GB) a cada carga: ~120 s. Descompactado uma
# vez aqui, a carga cai para ~25 s. CAPIAU_CANARY_DIR troca o lugar.
CANARY_DIR = os.getenv("CAPIAU_CANARY_DIR") or os.path.expanduser("~/.cache/capiau/canary-1b-v2")


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


def canary(audio_path: str, idioma: str) -> dict:
    from huggingface_hub import hf_hub_download
    from nemo.collections.asr.models import ASRModel
    from nemo.core.connectors.save_restore_connector import SaveRestoreConnector

    t0 = time.perf_counter()
    nemo = hf_hub_download(CANARY_REPO, CANARY_ARQUIVO)
    if not os.path.exists(os.path.join(CANARY_DIR, "model_config.yaml")):
        os.makedirs(CANARY_DIR, exist_ok=True)
        with tarfile.open(nemo) as tf:
            tf.extractall(CANARY_DIR)
    conector = SaveRestoreConnector()
    conector.model_extracted_dir = CANARY_DIR
    modelo = ASRModel.restore_from(nemo, map_location="cpu", save_restore_connector=conector)
    modelo.eval()
    carga = time.perf_counter() - t0

    t0 = time.perf_counter()
    saida = modelo.transcribe([audio_path], source_lang=idioma, target_lang=idioma, timestamps=True, batch_size=1)
    palavras = (saida[0].timestamp or {}).get("word") or []
    return {
        "modelo": CANARY_REPO,
        "carga_s": round(carga, 2),
        "inferencia_s": round(time.perf_counter() - t0, 2),
        "palavras": [{"word": w["word"], "start": float(w["start"]), "end": float(w["end"])} for w in palavras],
    }


def main(argv):
    if len(argv) == 4 and argv[1] == "diarizar":
        resultado = diarizar(argv[2])
    elif len(argv) == 5 and argv[1] == "canary":
        resultado = canary(argv[2], argv[4])
    else:
        print(__doc__, file=sys.stderr)
        return 2
    with open(argv[3], "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
