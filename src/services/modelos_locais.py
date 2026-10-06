"""Catálogo dos modelos locais opcionais: o que existe, quanto pesa, se está baixado.

Regra da casa: nenhum modelo grande baixa sozinho. Os motores perguntam aqui
(``exigir``) antes de carregar; se faltar, recebem ``ModeloNaoBaixado`` com o
tamanho e onde baixar, e quem chama cai num caminho que funciona e avisa.
O download só acontece quando o usuário pede (``baixar``, chamado pela rota
/api/modelos/{id}/baixar, em segundo plano).

Tamanhos conferidos nos repositórios/caches em 05/10/2026.
"""
from __future__ import annotations

import glob
import importlib.util
import os
import tarfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

RAIZ = Path(__file__).resolve().parents[2]


class ModeloNaoBaixado(RuntimeError):
    """O modelo (ou o pacote/ambiente que ele precisa) não está nesta máquina."""


@dataclass(frozen=True)
class ModeloLocal:
    id: str
    nome: str
    uso: str                         # para que serve, em uma linha
    tamanho_mb: int                  # download dos pesos
    ambiente: str                    # "principal" (.venv) ou "nemo" (.venv-nemo)
    pacotes: Tuple[str, ...]         # nomes de import (principal) ou pastas em site-packages (nemo)
    repo: Optional[str] = None       # repositório no Hugging Face
    padroes: Tuple[str, ...] = ()    # allow_patterns do download
    marcadores: Tuple[str, ...] = () # arquivos que provam que está baixado (relativos ao snapshot)
    termos_url: Optional[str] = None # repositório que exige aceitar termos
    configuracao: Tuple[str, ...] = ()  # valores de Configurações que usam o modelo (chave=valor)
    idiomas: Optional[Tuple[str, ...]] = None  # só serve para estes idiomas (None = todos)
    obs: str = ""


# Whisper local (faster-whisper): nome, repositório, MB do model.bin (conferido no
# Hugging Face em 05/10/2026), uso. Os .en e os distil só transcrevem inglês.
WHISPERS = [
    ("tiny", "Systran/faster-whisper-tiny", 76, "Transcrição local mínima; fraca em português"),
    ("base", "Systran/faster-whisper-base", 145, "Transcrição local leve; fraca em português"),
    ("small", "Systran/faster-whisper-small", 484, "Transcrição local leve; reserva sem internet"),
    ("medium", "Systran/faster-whisper-medium", 1528, "Transcrição local média"),
    ("large-v1", "Systran/faster-whisper-large-v1", 3087, "Transcrição local grande (versão antiga)"),
    ("large-v2", "Systran/faster-whisper-large-v2", 3087, "Transcrição local grande (versão antiga)"),
    ("large-v3", "Systran/faster-whisper-large-v3", 3087, "Transcrição local grande; mais lenta que a turbo"),
    ("large-v3-turbo", "mobiuslabsgmbh/faster-whisper-large-v3-turbo", 1618,
     "Transcrição local na CPU (~0,4x o tempo do áudio); padrão do Whisper"),
    ("tiny.en", "Systran/faster-whisper-tiny.en", 76, "Só inglês"),
    ("base.en", "Systran/faster-whisper-base.en", 145, "Só inglês"),
    ("small.en", "Systran/faster-whisper-small.en", 484, "Só inglês"),
    ("medium.en", "Systran/faster-whisper-medium.en", 1528, "Só inglês"),
    ("distil-small.en", "Systran/faster-distil-whisper-small.en", 332, "Só inglês, rápido"),
    ("distil-medium.en", "Systran/faster-distil-whisper-medium.en", 789, "Só inglês, rápido"),
    ("distil-large-v2", "Systran/faster-distil-whisper-large-v2", 1513, "Só inglês, rápido"),
    ("distil-large-v3", "Systran/faster-distil-whisper-large-v3", 1513, "Só inglês, rápido"),
    ("distil-large-v3.5", "distil-whisper/distil-large-v3.5-ct2", 1513, "Só inglês, rápido"),
]


CATALOGO: Dict[str, ModeloLocal] = {m.id: m for m in [
    ModeloLocal(
        id="laya_multilingual", nome="Laya multilíngue",
        uso="Triagem local na CPU (Sistema 1), em modo sombra ou decidindo",
        tamanho_mb=650, ambiente="principal", pacotes=("laya",),
        repo="convaiinnovations/laya",
        padroes=("multilingual/rl_agent_config.json", "multilingual/model.safetensors",
                 "multilingual/tokenizer/*", "multilingual/encoder/*"),
        marcadores=("multilingual/model.safetensors",),
        configuracao=("triage.system1_enabled=true",)),
    *[ModeloLocal(
        id=f"whisper_{nome}", nome=f"Whisper {nome}",
        uso=uso, tamanho_mb=mb, ambiente="principal", pacotes=("faster_whisper",),
        repo=repo, marcadores=("model.bin",),
        configuracao=(f"asr.whisper_model={nome}",),
        idiomas=("en",) if (nome.endswith(".en") or nome.startswith("distil-")) else None)
      for nome, repo, mb, uso in WHISPERS],
    ModeloLocal(
        id="sensevoice_small", nome="SenseVoice Small",
        uso="Transcrição local rápida, só chinês, inglês, japonês, coreano e cantonês",
        tamanho_mb=940, ambiente="nemo", pacotes=("funasr",),
        repo="FunAudioLLM/SenseVoiceSmall", marcadores=("model.pt",),
        configuracao=("transcription.engine=sensevoice",),
        idiomas=("zh", "en", "ja", "ko", "yue")),
    ModeloLocal(
        id="canary_1b_v2", nome="NVIDIA Canary 1B v2",
        uso="Transcrição local na CPU (~1,5x o tempo do áudio); pode repetir frases em áudio ruidoso",
        tamanho_mb=6360, ambiente="nemo", pacotes=("nemo",),
        repo="nvidia/canary-1b-v2", padroes=("canary-1b-v2.nemo",),
        configuracao=("transcription.engine=nvidia_canary",),
        obs="Baixa 6,4 GB, descompacta (carga de ~25 s em vez de ~120 s) e apaga o arquivo original: fica 6 GB em disco."),
    ModeloLocal(
        id="nemotron_diarization", nome="NVIDIA Nemotron 3 Diarization",
        uso="Separar falantes local (até 8 vozes, fala sobreposta)",
        tamanho_mb=400, ambiente="nemo", pacotes=("transformers",),
        repo="nvidia/Nemotron-3-Diarization",
        padroes=("config.json", "processor_config.json", "model.safetensors"),  # sem o .nemo e o .gguf
        marcadores=("model.safetensors",),
        configuracao=("diarization.engine=nemotron_3_diarization",)),
    ModeloLocal(
        id="pyannote_community1", nome="pyannote community-1",
        uso="Separar falantes local",
        tamanho_mb=32, ambiente="nemo", pacotes=("pyannote",),
        repo="pyannote/speaker-diarization-community-1", marcadores=("config.yaml",),
        termos_url="https://huggingface.co/pyannote/speaker-diarization-community-1",
        configuracao=("diarization.engine=pyannote_40",)),
    ModeloLocal(
        id="yolo_world", nome="YOLO-World v2 (s) + CLIP ViT-B/32",
        uso="Detector de objetos local rápido (~0,5 s por quadro)",
        tamanho_mb=380, ambiente="principal", pacotes=("ultralytics", "clip"),
        configuracao=("object.detector_engine=yolo_world",),
        obs="Baixa do GitHub da Ultralytics, não do Hugging Face."),
    ModeloLocal(
        id="owlv2", nome="OWLv2 base",
        uso="Detector de objetos local (~4 s por quadro)",
        tamanho_mb=620, ambiente="principal", pacotes=("transformers",),
        repo="google/owlv2-base-patch16-ensemble",
        padroes=("*.json", "*.txt", "model.safetensors"), marcadores=("model.safetensors",),
        configuracao=("object.detector_engine=owlv2",)),
    ModeloLocal(
        id="grounding_dino", nome="Grounding DINO tiny",
        uso="Detector de objetos local (~8 s por quadro)",
        tamanho_mb=690, ambiente="principal", pacotes=("transformers",),
        repo="IDEA-Research/grounding-dino-tiny",
        padroes=("*.json", "*.txt", "model.safetensors"), marcadores=("model.safetensors",),
        configuracao=("object.detector_engine=grounding_dino",)),
    ModeloLocal(
        id="florence_2", nome="Florence-2 base",
        uso="Detector local; não informa confiança e marca toda classe pedida",
        tamanho_mb=465, ambiente="principal", pacotes=("transformers",),
        repo="florence-community/Florence-2-base",
        padroes=("*.json", "*.txt", "model.safetensors"), marcadores=("model.safetensors",),
        configuracao=("object.detector_engine=florence_2",)),
]}


# -- Onde as coisas ficam -----------------------------------------------------------------

def pasta_ultralytics() -> Path:
    return Path(os.getenv("CAPIAU_ULTRALYTICS_DIR") or Path.home() / ".cache" / "capiau" / "ultralytics")


def pasta_canary() -> Path:
    return Path(os.getenv("CAPIAU_CANARY_DIR") or Path.home() / ".cache" / "capiau" / "canary-1b-v2")


def python_venv_nemo() -> Path:
    base = Path(os.getenv("CAPIAU_VENV_NEMO") or (RAIZ / ".venv-nemo"))
    return base / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _cache_hf() -> Path:
    from huggingface_hub import constants
    return Path(constants.HF_HUB_CACHE)


def _no_cache_hf(repo: str, arquivo: str) -> bool:
    """Arquivo presente em QUALQUER snapshot do repo (a Laya fixa uma revisão própria)."""
    pasta = _cache_hf() / ("models--" + repo.replace("/", "--")) / "snapshots"
    return any(Path(p).is_file() for p in glob.glob(str(pasta / "*" / arquivo)))


# -- Estado -------------------------------------------------------------------------------

def _pacotes_ok(m: ModeloLocal) -> Tuple[bool, List[str]]:
    if m.ambiente == "principal":
        faltam = [p for p in m.pacotes if importlib.util.find_spec(p) is None]
        return not faltam, faltam
    py = python_venv_nemo()
    if not py.exists():
        return False, [".venv-nemo"]
    site = py.parent.parent / ("Lib/site-packages" if os.name == "nt" else "lib")
    faltam = [p for p in m.pacotes if not (site / p).exists()]
    return not faltam, faltam


def baixado(m: ModeloLocal) -> bool:
    if m.id == "canary_1b_v2":  # só a pasta descompactada fica; o .nemo é apagado
        pasta = pasta_canary()
        return (pasta / "model_config.yaml").is_file() and (pasta / "model_weights.ckpt").is_file()
    if m.id == "yolo_world":
        pesos = pasta_ultralytics() / "weights"
        return (pesos / "yolov8s-worldv2.pt").is_file() and (pesos / "clip" / "ViT-B-32.pt").is_file()
    return bool(m.repo) and all(_no_cache_hf(m.repo, a) for a in m.marcadores)


def estado(m: ModeloLocal) -> Dict:
    pacotes_ok, faltam = _pacotes_ok(m)
    tarefa = _tarefas.get(m.id)
    return {
        "id": m.id, "nome": m.nome, "uso": m.uso, "tamanho_mb": m.tamanho_mb,
        "ambiente": m.ambiente, "baixado": baixado(m), "pacotes_ok": pacotes_ok, "pacotes_faltando": faltam,
        "termos_url": m.termos_url, "configuracao": list(m.configuracao),
        "idiomas": list(m.idiomas) if m.idiomas else None, "obs": m.obs,
        "download": tarefa,
    }


def listar() -> List[Dict]:
    return [estado(m) for m in CATALOGO.values()]


def exigir(modelo_id: str) -> ModeloLocal:
    """Para os motores: levanta ModeloNaoBaixado com instrução se não der para usar."""
    m = CATALOGO[modelo_id]
    pacotes_ok, faltam = _pacotes_ok(m)
    if not pacotes_ok:
        onde = "no ambiente .venv-nemo (ver requirements-nemo.txt)" if m.ambiente == "nemo" \
            else "(ver requirements-opcional.txt)"
        raise ModeloNaoBaixado(f"{m.nome}: falta instalar {', '.join(faltam)} {onde}")
    if not baixado(m):
        raise ModeloNaoBaixado(f"{m.nome} não está baixado ({_tamanho(m)}); "
                               f"baixe em Configurações > Modelos locais")
    return m


def _tamanho(m: ModeloLocal) -> str:
    return f"{m.tamanho_mb / 1000:.1f} GB".replace(".", ",") if m.tamanho_mb >= 1000 else f"{m.tamanho_mb} MB"


# -- Download (só a pedido do usuário) --------------------------------------------------------

_tarefas: Dict[str, Dict] = {}
_trava = threading.Lock()


def _baixar_hf(m: ModeloLocal) -> None:
    from huggingface_hub import snapshot_download
    kw = {"allow_patterns": list(m.padroes)} if m.padroes else {}
    if m.id == "laya_multilingual":
        from laya.revisions import resolve_revision  # a Laya carrega uma revisão fixa
        revisao = resolve_revision(m.repo, None)
        if revisao:
            kw["revision"] = revisao
    if m.id == "canary_1b_v2":
        _descompactar_canary(m)  # baixa o .nemo, descompacta e apaga o original
        return
    snapshot_download(m.repo, **kw)


def _descompactar_canary(m: ModeloLocal) -> None:
    """Descompacta o .nemo na pasta do Canary e apaga o original (6,4 GB a menos em disco)."""
    from huggingface_hub import hf_hub_download
    destino = pasta_canary()
    nemo = Path(hf_hub_download(m.repo, "canary-1b-v2.nemo"))
    if not (destino / "model_config.yaml").exists():
        destino.mkdir(parents=True, exist_ok=True)
        with tarfile.open(nemo) as tf:
            tf.extractall(destino)
    if (destino / "model_weights.ckpt").is_file():
        nemo.unlink(missing_ok=True)


def _baixar_yolo_world() -> None:
    from src.vision.detectores import _carregar_yolo_world
    modelo = _carregar_yolo_world(permitir_download=True)
    modelo.set_classes(["person"])  # baixa o CLIP de texto


def baixar(modelo_id: str, ao_mudar: Optional[Callable[[Dict], None]] = None) -> Dict:
    """Começa o download em segundo plano. Devolve o estado da tarefa."""
    m = CATALOGO[modelo_id]
    pacotes_ok, faltam = _pacotes_ok(m)
    if not pacotes_ok:
        raise ModeloNaoBaixado(f"{m.nome}: instale antes {', '.join(faltam)}")
    with _trava:
        atual = _tarefas.get(modelo_id)
        if atual and atual["status"] == "baixando":
            return dict(atual)
        tarefa = {"status": "baixando", "erro": None}
        _tarefas[modelo_id] = tarefa

    def rodar():
        try:
            if m.id == "yolo_world":
                _baixar_yolo_world()
            else:
                _baixar_hf(m)
            tarefa["status"] = "pronto"
        except Exception as e:
            msg = str(e)
            if "gated" in msg.lower() or "403" in msg:
                msg = f"acesso negado: aceite os termos em {m.termos_url or 'huggingface.co/' + str(m.repo)}"
            tarefa.update(status="falhou", erro=msg[:300])
        if ao_mudar:
            ao_mudar(dict(tarefa))

    retrato = dict(tarefa)  # estado no momento do pedido; a thread segue mudando o original
    threading.Thread(target=rodar, name=f"baixar-{modelo_id}", daemon=True).start()
    return retrato
