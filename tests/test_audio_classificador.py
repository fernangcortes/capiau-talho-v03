"""Camada 2 do áudio: tipo de som (docs/PLANO_AUDIO_CATEGORIAS.md).

Motor falso nos testes de decisão e de leitura; o motor real só roda se os pesos
do PANNs Cnn10 já estiverem no cache do Hugging Face (nada é baixado aqui).
"""
import glob
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from src.media import audio_classificador as AC
from src.nlp.prompt_registry import normalizar_categoria

ROTULOS = AC.rotulos_audioset()
FALA, MUSICA = ROTULOS.index("Speech"), ROTULOS.index("Music")
tem_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg fora do PATH")


def _medidas(janelas_fala=0, janelas_musica=0, janelas_outras=0, duracao=60.0, nivel_db=-20.0, desvio_db=6.0):
    linhas = []
    for idx, n in ((FALA, janelas_fala), (MUSICA, janelas_musica), (None, janelas_outras)):
        for _ in range(n):
            p = np.full(len(ROTULOS), 0.02)
            if idx is not None:
                p[idx] = 0.9
            linhas.append(p)
    rng = np.random.default_rng(0)
    rms = nivel_db + rng.normal(0, desvio_db, int(duracao / AC.QUADRO_RMS_S))
    return AC.Medidas(duracao=duracao, rms_db=rms, probs=np.array(linhas))


@pytest.mark.parametrize("medidas, esperado", [
    (_medidas(janelas_musica=9, janelas_fala=1), "trilha"),
    (_medidas(janelas_fala=8, janelas_outras=2), "depoimento"),
    (_medidas(janelas_outras=1, duracao=3.0), "efeito"),
    (_medidas(janelas_outras=12, nivel_db=-62.0, desvio_db=1.0), "room_tone"),
    (_medidas(janelas_outras=12, nivel_db=-62.0, desvio_db=9.0), "ambiente"),  # baixo mas com eventos
    (_medidas(janelas_outras=12, nivel_db=-30.0, desvio_db=1.0), "ambiente"),  # constante mas alto
])
def test_decisao_pelo_som(medidas, esperado):
    r = AC.decidir(medidas, ROTULOS)
    assert r.categoria == esperado
    assert set(r.sinais) >= {"frac_fala", "frac_musica", "nivel_mediana_db", "nivel_desvio_db", "classes_topo"}


def test_canto_nao_vira_depoimento_quando_a_musica_domina():
    m = _medidas(janelas_musica=10)
    m.probs[:, FALA] = 0.6  # voz cantada acende 'Speech' também
    assert AC.decidir(m, ROTULOS).categoria == "trilha"


@pytest.mark.parametrize("caminho, esperado", [
    ("D:/makinof-monstro/trilha/TUDO E NADA (DEMO).mp4", "trilha"),
    ("D:/som/SFX/porta batendo.wav", "efeito"),
    ("D:/som/rt_sala_02.wav", "room_tone"),
    ("D:/som/Room Tone cozinha.wav", "room_tone"),
    ("D:/som/amb rua noite.wav", "ambiente"),
    ("D:/som/Locução final.wav", "locucao"),
    ("D:/makinof-monstro/Entrevistas/todas juncoes/entrevista-som-bruno.wav", "depoimento"),
    ("D:/makinof-monstro/MVI_0727.MOV", None),
    ("D:/som/artesanato.wav", None),  # 'rt' só como palavra inteira
])
def test_dica_do_nome(caminho, esperado):
    assert AC.dica_do_nome(Path(caminho)) == esperado


def test_nome_que_confirma_sobe_a_confianca_e_o_que_discorda_vai_para_revisao():
    som_de_fala = _medidas(janelas_fala=6, janelas_outras=4)
    assert AC.decidir(som_de_fala, ROTULOS).confianca == pytest.approx(0.6)
    r = AC.decidir(som_de_fala, ROTULOS, Path("D:/Entrevistas/joana.wav"))
    assert (r.categoria, r.confianca) == ("depoimento", 0.9)
    r = AC.decidir(som_de_fala, ROTULOS, Path("D:/som/locucao_abertura.wav"))
    assert (r.categoria, r.confianca) == ("locucao", 0.9), "fala + nome de locução: locução"
    r = AC.decidir(som_de_fala, ROTULOS, Path("D:/trilha/faixa1.wav"))
    assert (r.categoria, r.confianca) == ("trilha", 0.5), "nome e som discordam: vale o nome, incerto"
    assert "o som diz depoimento" in r.motivo


def test_normalizar_categoria_de_audio():
    assert normalizar_categoria("Trilha", "audio") == "trilha"
    assert normalizar_categoria("Room tone", "audio") == "room_tone"
    assert normalizar_categoria("Locução", "audio") == "locucao"
    assert normalizar_categoria("depoimento", "audio") == "depoimento"
    assert normalizar_categoria("cena", "audio") is None
    assert normalizar_categoria("trilha") is None, "fora do áudio a taxonomia é a de imagem"


class MotorFalso:
    nome = "falso"
    rotulos = ROTULOS

    def __init__(self):
        self.janelas = []

    def probabilidades(self, janelas):
        self.janelas.extend(janelas)
        p = np.full((len(janelas), len(ROTULOS)), 0.02)
        p[:, MUSICA] = 0.9
        return p


@tem_ffmpeg
def test_medir_le_o_arquivo_inteiro_e_amostra_as_janelas(tmp_path, monkeypatch):
    wav = tmp_path / "silencio_e_tom.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-t", "20", "-i", "anullsrc=r=16000:cl=mono",
                    "-f", "lavfi", "-t", "20", "-i", "sine=frequency=440:sample_rate=16000",
                    "-filter_complex", "[0][1]concat=n=2:v=0:a=1", str(wav)], check=True)
    monkeypatch.setattr(AC, "MAX_JANELAS", 4)
    motor = MotorFalso()
    m = AC.medir(wav, 40.0, motor)
    assert len(motor.janelas) == 4, "8 janelas de 5 s, teto 4: uma a cada duas"
    assert all(len(j) == AC.JANELA_S * AC.TAXA for j in motor.janelas)
    assert len(m.rms_db) == 80, "o nível cobre o arquivo inteiro"
    # o tom do lavfi tem amplitude 1/8: RMS de ~-21 dBFS
    assert m.rms_db[:40].max() == AC.PISO_DB and m.rms_db[40:] == pytest.approx(-21.1, abs=0.1)
    assert AC.decidir(m, ROTULOS).categoria == "trilha"


@tem_ffmpeg
def test_arquivo_curto_vira_uma_janela(tmp_path):
    wav = tmp_path / "estalo.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=1000", "-t", "1.2",
                    str(wav)], check=True)
    motor = MotorFalso()
    m = AC.medir(wav, 1.2, motor)
    assert len(motor.janelas) == 1


PESOS = glob.glob(str(Path.home() / ".cache/huggingface/hub/models--nicofarr--panns_Cnn10/snapshots/*/model.safetensors"))


@tem_ffmpeg
@pytest.mark.skipif(not PESOS, reason="PANNs Cnn10 não está no cache (Configurações > Modelos locais)")
def test_motor_real_reconhece_um_tom_puro(tmp_path):
    wav = tmp_path / "tom.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "6",
                    str(wav)], check=True)
    motor = AC.MotorPANNs(Path(PESOS[0]))
    r = AC.classificar(wav, 6.0, motor)
    assert r.sinais["classes_topo"][0] == "Sine wave", "ordem dos rótulos bate com a dos pesos"
    assert r.categoria == "efeito"
