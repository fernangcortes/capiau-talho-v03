"""Camada 2 do áudio: que tipo de som é (docs/PLANO_AUDIO_CATEGORIAS.md, seção 3).

Local, em CPU. Um classificador AudioSet (PANNs Cnn10, 25 MB) dá a probabilidade
de 527 classes em janelas do arquivo; heurísticas de nível (RMS), duração e nome
do arquivo/pasta somam a isso, e `decidir` devolve uma das categorias de áudio.

⚠ FALTA CALIBRAR: os limiares abaixo são genéricos. Não há no acervo exemplos
de efeito, room tone, ambiente e locução (seção 6 do plano).

O modelo é o Cnn10 de Kong et al., "PANNs: Large-Scale Pretrained Audio Neural
Networks" (github.com/qiuqiangkong/audioset_tagging_cnn, MIT), com os pesos do
repositório nicofarr/panns_Cnn10 (Apache-2.0). O STFT e o banco mel vêm dentro
dos pesos: não precisa de librosa. Rótulos do AudioSet (CC BY 4.0, Google) em
audioset_rotulos.txt, na ordem do class_labels_indices.csv.
"""
from __future__ import annotations

import os
import re
import subprocess
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Protocol

import numpy as np

TAXA = 32000            # o Cnn10 foi treinado a 32 kHz
JANELA_S = 5.0          # trecho que o modelo vê de cada vez
MAX_JANELAS = 48        # teto por arquivo: arquivo longo é amostrado por igual (4 min de som)
QUADRO_RMS_S = 0.5      # o nível é medido no arquivo inteiro, em quadros de meio segundo
PISO_DB = -90.0

# --- limiares genéricos (a calibrar) ---
LIMIAR_JANELA = 0.5     # janela "tem fala" / "tem música" quando a classe passa disto
FRAC_MUSICA = 0.5       # metade das janelas com música -> trilha
FRAC_FALA = 0.4         # 40% das janelas com fala -> fala (depoimento/locução)
EFEITO_MAX_S = 10.0     # mais curto que isto, sem fala nem música -> efeito
ROOM_TONE_MAX_DB = -50.0  # mediana do nível abaixo disto...
ROOM_TONE_DESVIO_DB = 4.0  # ...e quase constante -> room tone

CATEGORIAS_SEM_FALA = ("trilha", "efeito", "ambiente", "room_tone")

_FALA = ("Speech", "Conversation", "Narration, monologue", "Male speech, man speaking",
         "Female speech, woman speaking", "Child speech, kid speaking", "Speech synthesizer")
_MUSICA = ("Music",)

# Nome do arquivo ou de uma pasta -> categoria. Palavra inteira, sem acento, sem caixa.
DICAS_DE_NOME = [
    ("trilha", ("trilha", "musica", "music", "soundtrack", "ost", "score")),
    ("efeito", ("sfx", "efeito", "efeitos", "foley", "fx")),
    ("room_tone", ("room tone", "roomtone", "room_tone", "rt", "silencio", "tom de sala")),
    ("ambiente", ("ambiente", "ambiencia", "ambience", "amb", "atmos")),
    ("locucao", ("locucao", "narracao", "narrador", "voz off", "vo", "voiceover", "voice over", "off")),
    ("depoimento", ("entrevista", "entrevistas", "depoimento", "depoimentos", "interview")),
]


class Motor(Protocol):
    rotulos: List[str]
    nome: str

    def probabilidades(self, janelas: np.ndarray) -> np.ndarray:
        """(n, amostras) a 32 kHz -> (n, len(rotulos)), probabilidades independentes (sigmoide)."""


def rotulos_audioset() -> List[str]:
    caminho = Path(__file__).with_name("audioset_rotulos.txt")
    return [l for l in caminho.read_text(encoding="utf-8").splitlines() if l]


# -- Motor real ------------------------------------------------------------------------------

class MotorPANNs:
    """PANNs Cnn10 em torch puro, com os pesos do Hugging Face já baixados."""
    nome = "panns-cnn10"

    def __init__(self, caminho_pesos: Path):
        import torch
        from safetensors.torch import load_file
        self._torch = torch
        sd = {k.removeprefix("backbone."): v for k, v in load_file(str(caminho_pesos)).items()}
        self._sd = sd
        self.rotulos = rotulos_audioset()
        if sd["fc_audioset.weight"].shape[0] != len(self.rotulos):
            raise RuntimeError("pesos e rótulos do AudioSet não batem")

    def _bn(self, x, nome):
        F = self._torch.nn.functional
        s = self._sd
        return F.batch_norm(x, s[f"{nome}.running_mean"], s[f"{nome}.running_var"],
                            s[f"{nome}.weight"], s[f"{nome}.bias"], training=False, eps=1e-5)

    def _bloco(self, x, i):
        F = self._torch.nn.functional
        s = self._sd
        x = F.relu(self._bn(F.conv2d(x, s[f"conv_block{i}.conv1.weight"], padding=1), f"conv_block{i}.bn1"))
        x = F.relu(self._bn(F.conv2d(x, s[f"conv_block{i}.conv2.weight"], padding=1), f"conv_block{i}.bn2"))
        return F.avg_pool2d(x, 2)

    def probabilidades(self, janelas: np.ndarray) -> np.ndarray:
        torch = self._torch
        F = torch.nn.functional
        s = self._sd
        with torch.inference_mode():
            x = torch.from_numpy(np.ascontiguousarray(janelas, dtype=np.float32))[:, None, :]
            x = F.pad(x, (512, 512), mode="reflect")  # STFT centrado (n_fft 1024)
            re_ = F.conv1d(x, s["spectrogram_extractor.stft.conv_real.weight"], stride=320)
            im_ = F.conv1d(x, s["spectrogram_extractor.stft.conv_imag.weight"], stride=320)
            pot = (re_ ** 2 + im_ ** 2).transpose(1, 2)            # (n, quadros, 513)
            mel = torch.matmul(pot, s["logmel_extractor.melW"])     # (n, quadros, 64)
            x = (10.0 * torch.log10(torch.clamp(mel, min=1e-10)))[:, None]  # (n, 1, quadros, 64)
            x = self._bn(x.transpose(1, 3), "bn0").transpose(1, 3)  # normalização por faixa mel
            for i in range(1, 5):
                x = self._bloco(x, i)
            x = x.mean(dim=3)
            x = x.max(dim=2).values + x.mean(dim=2)
            x = F.relu(F.linear(x, s["fc1.weight"], s["fc1.bias"]))
            return torch.sigmoid(F.linear(x, s["fc_audioset.weight"], s["fc_audioset.bias"])).numpy()


_motor: Optional[MotorPANNs] = None


def carregar_motor() -> MotorPANNs:
    """Levanta ModeloNaoBaixado (com tamanho e onde baixar) se o modelo não estiver aqui.
    Carrega uma vez por processo (25 MB)."""
    global _motor
    if _motor is None:
        from huggingface_hub import hf_hub_download
        from src.services.modelos_locais import exigir
        m = exigir("panns_cnn10")
        _motor = MotorPANNs(Path(hf_hub_download(m.repo, "model.safetensors", local_files_only=True)))
    return _motor


# -- Medidas do arquivo -----------------------------------------------------------------------

@dataclass
class Medidas:
    duracao: float
    rms_db: np.ndarray                 # nível por quadro de meio segundo, arquivo inteiro
    probs: np.ndarray                  # (janelas, classes)
    latencia_ms: float = 0.0


def _startupinfo():
    if os.name != "nt":
        return None
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return si


def _passo_de_amostragem(duracao: float) -> int:
    total = max(1, int(np.ceil(duracao / JANELA_S)))
    return max(1, int(np.ceil(total / MAX_JANELAS)))


def medir(caminho: Path, duracao: float, motor: Motor) -> Medidas:
    """Lê o som do arquivo inteiro uma vez (ffmpeg, mono 32 kHz): nível em todo ele,
    classes do AudioSet em até MAX_JANELAS janelas espalhadas por igual."""
    inicio = time.perf_counter()
    passo = _passo_de_amostragem(duracao)
    amostras_janela = int(JANELA_S * TAXA)
    amostras_quadro = int(QUADRO_RMS_S * TAXA)
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", str(caminho), "-vn", "-ac", "1", "-ar", str(TAXA), "-f", "f32le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, startupinfo=_startupinfo())
    janelas, rms, i = [], [], 0
    try:
        while True:
            bruto = proc.stdout.read(amostras_janela * 4)
            if not bruto:
                break
            sinal = np.frombuffer(bruto, np.float32)
            n = len(sinal) // amostras_quadro
            if n:
                q = sinal[: n * amostras_quadro].reshape(n, amostras_quadro)
                rms.extend(20 * np.log10(np.maximum(np.sqrt((q.astype(np.float64) ** 2).mean(axis=1)), 1e-10)))
            # Janela curta no fim só entra se o arquivo inteiro for curto (efeito de 2 s)
            if i % passo == 0 and (len(sinal) == amostras_janela or not janelas):
                janelas.append(np.pad(sinal, (0, amostras_janela - len(sinal))) if len(sinal) < amostras_janela else sinal)
            i += 1
    finally:
        proc.stdout.close()
        proc.wait()
    if not janelas:
        raise RuntimeError(f"sem som legível em {Path(caminho).name}")
    probs = np.concatenate([motor.probabilidades(np.stack(janelas[k:k + 8])) for k in range(0, len(janelas), 8)])
    rms_db = np.maximum(np.array(rms, dtype=np.float64), PISO_DB) if rms else np.array([PISO_DB])
    return Medidas(duracao=duracao or len(rms) * QUADRO_RMS_S, rms_db=rms_db, probs=probs,
                   latencia_ms=(time.perf_counter() - inicio) * 1000)


# -- Decisão ----------------------------------------------------------------------------------

@dataclass
class Resultado:
    categoria: str
    confianca: float
    motivo: str
    sinais: Dict[str, object] = field(default_factory=dict)


def _sem_acento(texto: str) -> str:
    return unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()


def dica_do_nome(caminho: Path) -> Optional[str]:
    """Categoria sugerida pelo nome do arquivo ou de uma das três pastas acima dele."""
    partes = [Path(caminho).stem, *[p.name for p in list(Path(caminho).parents)[:3]]]
    for parte in partes:
        texto = " " + re.sub(r"[^a-z0-9]+", " ", _sem_acento(parte)) + " "
        for categoria, palavras in DICAS_DE_NOME:
            if any(f" {p} " in texto for p in palavras):
                return categoria
    return None


def _pontuacao(probs: np.ndarray, rotulos: List[str], nomes) -> np.ndarray:
    idx = [rotulos.index(n) for n in nomes if n in rotulos]
    return probs[:, idx].max(axis=1) if idx else np.zeros(len(probs))


def _pelo_som(m: Medidas, rotulos: List[str]) -> Resultado:
    fala = _pontuacao(m.probs, rotulos, _FALA)
    musica = _pontuacao(m.probs, rotulos, _MUSICA)
    media = m.probs.mean(axis=0)
    topo = [rotulos[i] for i in np.argsort(media)[::-1][:5]]
    ativos = m.rms_db[m.rms_db > PISO_DB]
    sinais = {
        "duracao_s": round(float(m.duracao), 2),
        "janelas": int(len(m.probs)),
        "frac_fala": round(float((fala >= LIMIAR_JANELA).mean()), 3),
        "frac_musica": round(float((musica >= LIMIAR_JANELA).mean()), 3),
        "fala_media": round(float(fala.mean()), 3),
        "musica_media": round(float(musica.mean()), 3),
        "nivel_mediana_db": round(float(np.median(m.rms_db)), 1),
        "nivel_desvio_db": round(float(ativos.std()) if len(ativos) > 1 else 0.0, 1),
        "classes_topo": topo,
    }
    s = sinais
    if s["frac_musica"] >= FRAC_MUSICA and s["musica_media"] >= s["fala_media"]:
        return Resultado("trilha", s["frac_musica"], "música na maior parte", sinais)
    if s["frac_fala"] >= FRAC_FALA:
        # Depoimento ou locução pede número de vozes (diarização): sem ela, depoimento,
        # com a confiança da fala. Locução hoje só pelo nome. A calibrar.
        return Resultado("depoimento", s["frac_fala"], "fala na maior parte", sinais)
    if s["duracao_s"] < EFEITO_MAX_S:
        return Resultado("efeito", 0.5, "curto, sem fala nem música", sinais)
    if s["nivel_mediana_db"] < ROOM_TONE_MAX_DB and s["nivel_desvio_db"] < ROOM_TONE_DESVIO_DB:
        return Resultado("room_tone", 0.5, "nível baixo e constante", sinais)
    return Resultado("ambiente", 0.5, "sem fala nem música dominantes", sinais)


def decidir(m: Medidas, rotulos: List[str], caminho: Optional[Path] = None) -> Resultado:
    """Som primeiro; o nome confirma (sobe a confiança) ou discorda (vale o nome, incerto,
    e o material vai para a fila de revisão)."""
    r = _pelo_som(m, rotulos)
    dica = dica_do_nome(caminho) if caminho else None
    r.sinais["dica_nome"] = dica
    if not dica:
        return r
    concordam = dica == r.categoria or {dica, r.categoria} <= {"depoimento", "locucao"}
    if concordam:
        return Resultado(dica, max(r.confianca, 0.9), f"{r.motivo}; o nome confirma", r.sinais)
    return Resultado(dica, 0.5, f"o nome diz {dica}, o som diz {r.categoria}", r.sinais)


def classificar(caminho: Path, duracao: float, motor: Motor) -> Resultado:
    m = medir(caminho, duracao, motor)
    r = decidir(m, motor.rotulos, caminho)
    r.sinais["latencia_ms"] = round(m.latencia_ms)
    return r
