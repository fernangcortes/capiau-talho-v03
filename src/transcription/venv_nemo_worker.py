"""Roda DENTRO do .venv-nemo (transformers >= 5.18), chamado como processo à parte.

O .venv principal tem transformers 5.15, que não conhece o Nemotron 3
Diarization; atualizar lá arriscaria a Laya e o resto. O Canary roda pelo
NeMo, porque só ele devolve tempo por palavra (pelo transformers sai só texto).
Este arquivo não importa nada de ``src``.

Uso (o lado de cá está em src/transcription/motores.py):
    python venv_nemo_worker.py diarizar <audio.wav> <saida.json>
    python venv_nemo_worker.py pyannote <audio.wav> <saida.json>
    python venv_nemo_worker.py canary <audio.wav> <saida.json> <idioma>
    python venv_nemo_worker.py sensevoice <audio.wav> <saida.json> <idioma>
O áudio chega sempre como WAV mono 16 kHz (convertido pelo lado de cá).
Saídas:
    diarizar, pyannote: {"modelo", "segmentos": [{"inicio": s, "fim": s, "falante": n}, ...]}
    canary, sensevoice: {"modelo", "palavras": [{"word", "start", "end"}, ...]}
"""
import json
import os
import sys
import tarfile
import time

NEMOTRON = "nvidia/Nemotron-3-Diarization"
PYANNOTE = "pyannote/speaker-diarization-community-1"
CANARY_REPO, CANARY_ARQUIVO = "nvidia/canary-1b-v2", "canary-1b-v2.nemo"
# O NeMo descompacta o .nemo (6,4 GB) a cada carga: ~120 s. Descompactado uma
# vez, a carga cai para ~25 s, e o .nemo pode ser apagado (o download pelo
# catálogo faz isso). CAPIAU_CANARY_DIR troca o lugar.
CANARY_DIR = os.getenv("CAPIAU_CANARY_DIR") or os.path.expanduser("~/.cache/capiau/canary-1b-v2")


def _ler_wav(audio_path: str, sr_esperado: int = 16000):
    """Lê o WAV com soundfile. Não usa transformers.audio_utils.load_audio: com o
    torchcodec instalado (vem com o pyannote) ele tenta o torchcodec, que no Windows
    falha com 'Could not load libtorchcodec' -- medido em 05/10/2026."""
    import soundfile as sf
    dados, sr = sf.read(audio_path, dtype="float32", always_2d=False)
    if sr != sr_esperado:
        raise ValueError(f"WAV em {sr} Hz; esperado {sr_esperado} Hz")
    if dados.ndim > 1:
        dados = dados.mean(axis=1)
    return dados


def pyannote(audio_path: str) -> dict:
    import torch
    from pyannote.audio import Pipeline

    t0 = time.perf_counter()
    pipeline = Pipeline.from_pretrained(PYANNOTE)
    carga = time.perf_counter() - t0

    dados = _ler_wav(audio_path)
    t0 = time.perf_counter()
    saida = pipeline({"waveform": torch.from_numpy(dados).unsqueeze(0), "sample_rate": 16000})
    anotacao = getattr(saida, "speaker_diarization", saida)
    nomes = {}
    segmentos = []
    for trecho, _, falante in anotacao.itertracks(yield_label=True):
        indice = nomes.setdefault(falante, len(nomes))  # SPEAKER_00 -> 0, na ordem em que aparecem
        segmentos.append({"inicio": float(trecho.start), "fim": float(trecho.end), "falante": indice})
    return {
        "modelo": PYANNOTE,
        "carga_s": round(carga, 2),
        "inferencia_s": round(time.perf_counter() - t0, 2),
        "segmentos": segmentos,
    }


def diarizar(audio_path: str) -> dict:
    import torch
    from transformers import AutoModelForAudioFrameClassification, AutoProcessor

    t0 = time.perf_counter()
    proc = AutoProcessor.from_pretrained(NEMOTRON)
    model = AutoModelForAudioFrameClassification.from_pretrained(NEMOTRON)
    model.eval()
    carga = time.perf_counter() - t0

    sr = proc.feature_extractor.sampling_rate
    audio = _ler_wav(audio_path, sr)
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
    if not os.path.exists(os.path.join(CANARY_DIR, "model_config.yaml")):
        nemo = hf_hub_download(CANARY_REPO, CANARY_ARQUIVO)
        os.makedirs(CANARY_DIR, exist_ok=True)
        with tarfile.open(nemo) as tf:
            tf.extractall(CANARY_DIR)
    conector = SaveRestoreConnector()
    conector.model_extracted_dir = CANARY_DIR
    # Com a pasta descompactada o NeMo usa só ela (modelPT.restore_from troca o caminho);
    # o .nemo original não precisa existir.
    modelo = ASRModel.restore_from(CANARY_DIR, map_location="cpu", save_restore_connector=conector)
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


SENSEVOICE = "FunAudioLLM/SenseVoiceSmall"
SENSEVOICE_JANELA_S = 25  # o modelo foi feito para trechos de até 30 s; o VAD do FunASR baixaria outro modelo


def sensevoice(audio_path: str, idioma: str) -> dict:
    from funasr import AutoModel

    t0 = time.perf_counter()
    modelo = AutoModel(model=SENSEVOICE, hub="hf", device="cpu", disable_update=True)
    carga = time.perf_counter() - t0

    dados = _ler_wav(audio_path)
    janela = SENSEVOICE_JANELA_S * 16000
    palavras = []
    t0 = time.perf_counter()
    for inicio in range(0, len(dados), janela):
        trecho = dados[inicio:inicio + janela]
        if len(trecho) < 1600:  # menos de 0,1 s
            continue
        res = modelo.generate(input=trecho, cache={}, language=idioma, use_itn=True, output_timestamp=True)
        desloc = inicio / 16000
        for r in res or []:
            for palavra, (ms_ini, ms_fim) in zip(r.get("words") or [], r.get("timestamp") or []):
                palavras.append({"word": palavra, "start": desloc + ms_ini / 1000, "end": desloc + ms_fim / 1000})
    return {"modelo": SENSEVOICE, "carga_s": round(carga, 2),
            "inferencia_s": round(time.perf_counter() - t0, 2), "palavras": palavras}


def main(argv):
    if len(argv) == 4 and argv[1] == "diarizar":
        resultado = diarizar(argv[2])
    elif len(argv) == 4 and argv[1] == "pyannote":
        resultado = pyannote(argv[2])
    elif len(argv) == 5 and argv[1] == "canary":
        resultado = canary(argv[2], argv[4])
    elif len(argv) == 5 and argv[1] == "sensevoice":
        resultado = sensevoice(argv[2], argv[4])
    else:
        print(__doc__, file=sys.stderr)
        return 2
    with open(argv[3], "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
