"""Testes da ponte com a DAW (Etapa 6): stems WAV 48/24 + relatorio de efeitos Tipo A.

Cobre: convencao de nomes (ida e volta casando), guardas (F:/, sobrescrita,
original intacto), export real via ffmpeg verificado com ffprobe, e o relatorio
.txt da secao 10 do plano. O teste do acervo real (F:) roda so se o arquivo e o
ffmpeg existirem nesta maquina.
"""
import json
import math
import os
import shutil
import struct
import subprocess
import unittest
import uuid
import wave
from pathlib import Path

from src.export.audio_stems import (
    CODEC_PCM,
    TAXA_AMOSTRAGEM,
    exportar_stems,
    formatar_tc,
    nome_stem,
    parse_nome_stem,
    relatorio_efeitos,
)

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")

ARQUIVO_REAL = Path(
    r"F:\Making Off - O Monstro\Entrevistas\entrevistas-completas"
    r"\entrevista-arte-julia-e-virshna.mts"
)

# Temporarios dentro da arvore do projeto e SEM tempfile.mkdtemp: o mkdtemp do
# Python 3.12+ cria a pasta com ACL restritiva no Windows, e a criacao de
# subpastas dentro dela e negada neste ambiente. mkdir comum funciona.
_RAIZ_TMP = Path(__file__).resolve().parents[1] / "data" / "_tmp_audio_stems"


def _nova_pasta(prefixo: str) -> Path:
    _RAIZ_TMP.mkdir(parents=True, exist_ok=True)
    pasta = _RAIZ_TMP / f"{prefixo}{os.getpid()}_{uuid.uuid4().hex[:8]}"
    pasta.mkdir()
    return pasta

precisa_ffmpeg = unittest.skipUnless(FFMPEG, "ffmpeg nao disponivel no PATH")


def _gerar_wav_fake(caminho: Path, segundos: float = 8.0, taxa: int = 48000, canais: int = 2) -> Path:
    """Midia de origem sintetica (sem ffmpeg) para os testes de export."""
    frames = int(segundos * taxa)
    with wave.open(str(caminho), "wb") as w:
        w.setnchannels(canais)
        w.setsampwidth(2)
        w.setframerate(taxa)
        passo = 2 * math.pi * 220.0 / taxa
        w.writeframes(b"".join(
            struct.pack("<" + "h" * canais, *[int(12000 * math.sin(passo * i))] * canais)
            for i in range(frames)
        ))
    return caminho


def _probe(caminho: Path) -> dict:
    cmd = [FFPROBE, "-v", "quiet", "-print_format", "json",
           "-show_streams", "-show_format", str(caminho)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(res.stdout)


class TestConvencaoNomes(unittest.TestCase):
    """O contrato de nome e o que permite o retorno automatico da DAW."""

    def test_formato_do_nome(self):
        self.assertEqual(
            nome_stem(17, 405.5, 415.5),
            "stem_v17_000405500-000415500.wav",
        )

    def test_ida_e_volta_casa(self):
        casos = [(17, 405.5, 415.5), (1, 0.0, 10.0), (90210, 3661.25, 3661.75), (3, 12.3456, 98.7654)]
        for vid, in_s, out_s in casos:
            nome = nome_stem(vid, in_s, out_s)
            vid2, in2, out2 = parse_nome_stem(nome)
            self.assertEqual((vid2, in2, out2), (vid, round(in_s * 1000) / 1000.0, round(out_s * 1000) / 1000.0),
                             f"ida e volta falhou para {nome}")
            # in e out sao arredondados separadamente: duracao casa com drift <= 1 ms.
            self.assertLessEqual(abs(round((out2 - in2) * 1000) - round((out_s - in_s) * 1000)), 1)

    def test_parse_aceita_caminho_completo(self):
        vid, in_s, out_s = parse_nome_stem(r"D:\daw\retorno\stem_v5_001230000-001240000.wav")
        self.assertEqual((vid, in_s, out_s), (5, 1230.0, 1240.0))

    def test_parse_recusa_nomes_fora_da_convencao(self):
        for nome in ["mixagem_final.wav", "stem_v17_405-415.wav", "stem_v17.wav",
                     "stem_v17_000405500-000415500.mp3", "tratado_stem_v17_000405500-000415500.wav"]:
            self.assertIsNone(parse_nome_stem(nome), f"deveria recusar: {nome}")

    def test_entradas_invalidas_levantan_erro(self):
        with self.assertRaises(ValueError):
            nome_stem(0, 1.0, 2.0)
        with self.assertRaises(ValueError):
            nome_stem(7, 5.0, 5.0)   # corte vazio
        with self.assertRaises(ValueError):
            nome_stem(7, 6.0, 5.0)   # corte invertido
        with self.assertRaises(ValueError):
            nome_stem(7, -1.0, 2.0)  # timecode negativo

    def test_formatar_tc(self):
        self.assertEqual(formatar_tc(405.5), "00:06:45.500")
        self.assertEqual(formatar_tc(0), "00:00:00.000")


class TestGuardas(unittest.TestCase):

    def test_recusa_destino_no_drive_f(self):
        # Puro teste de path: o guarda dispara antes de criar qualquer coisa.
        for destino in ["F:/qualquer/pasta", "f:/raiz", Path("F:\\Making Off - O Monstro\\stems")]:
            with self.assertRaises(ValueError, msg=f"deveria recusar {destino}"):
                exportar_stems({"clips": []}, destino, gerar_relatorio=False)

    @precisa_ffmpeg
    def test_nao_sobrescreve_sem_pedido_e_sobrescreve_com_pedido(self):
        tmp = _nova_pasta("stem_g_")
        self.addCleanup(shutil.rmtree, tmp, True)
        src = _gerar_wav_fake(tmp / "origem.wav")
        seq = {"fps": 24.0, "tracks": [{"id": "A1", "kind": "audio"}],
               "clips": [{"type": "video", "video_id": 7, "in": 1.0, "out": 2.0,
                          "track": "A1", "timeline_start": 0.0}]}
        res_caminho = lambda vid: src  # noqa: E731
        destino = tmp / "stems"
        r1 = exportar_stems(seq, destino, gerar_relatorio=False, resolver_caminho=res_caminho)
        alvo = r1["stems"][0]
        antes = alvo.read_bytes()
        with self.assertRaises(FileExistsError):
            exportar_stems(seq, destino, gerar_relatorio=False, resolver_caminho=res_caminho)
        r2 = exportar_stems(seq, destino, gerar_relatorio=False,
                            resolver_caminho=res_caminho, sobrescrever=True)
        self.assertEqual(r2["stems"][0], alvo)
        self.assertEqual(alvo.read_bytes(), antes)  # mesma entrada -> bytes iguais

    @precisa_ffmpeg
    def test_original_nao_e_tocado(self):
        tmp = _nova_pasta("stem_o_")
        self.addCleanup(shutil.rmtree, tmp, True)
        src = _gerar_wav_fake(tmp / "origem.wav")
        hash_antes = __import__("hashlib").sha256(src.read_bytes()).hexdigest()
        mtime_antes = src.stat().st_mtime_ns
        seq = {"fps": 24.0, "clips": [{"type": "video", "video_id": 7, "in": 0.5, "out": 2.5,
                                       "track": "A1", "timeline_start": 0.0}]}
        exportar_stems(seq, tmp / "stems", gerar_relatorio=False,
                       resolver_caminho=lambda vid: src)
        self.assertEqual(__import__("hashlib").sha256(src.read_bytes()).hexdigest(), hash_antes)
        self.assertEqual(src.stat().st_mtime_ns, mtime_antes)


@precisa_ffmpeg
class TestExportStems(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.tmp = _nova_pasta("stem_exp_")
        cls.src7 = _gerar_wav_fake(cls.tmp / "midia_7.wav")
        cls.src8 = _gerar_wav_fake(cls.tmp / "midia_8.wav")
        cls.caminhos = {7: cls.src7, 8: cls.src8}
        cls.nomes = {7: "entrevista_a.wav", 8: "amb_b.wav"}
        # c1: corte normal na V1; c2: par vinculado do MESMO corte na A1 (dedupe);
        # c3: outro intervalo; c4: midia inexistente; c5: foto; c6: pista de IA.
        cls.seq = {
            "version": 2, "fps": 24.0,
            "tracks": [
                {"id": "AI", "name": "IA", "kind": "ai"},
                {"id": "V1", "name": "Falas", "kind": "video"},
                {"id": "A1", "name": "Audio", "kind": "audio"},
            ],
            "clips": [
                {"type": "video", "video_id": 7, "in": 1.0, "out": 3.5,
                 "track": "V1", "timeline_start": 0.0},
                {"type": "video", "video_id": 7, "in": 1.0, "out": 3.5,
                 "track": "A1", "timeline_start": 0.0},
                {"type": "video", "video_id": 7, "in": 5.0, "out": 6.0,
                 "track": "A1", "timeline_start": 4.0},
                {"type": "video", "video_id": 8, "in": 0.0, "out": 2.0,
                 "track": "A1", "timeline_start": 6.0},
                {"type": "photo", "photo_id": 1, "in": 0.0, "out": 3.0,
                 "track": "V1", "timeline_start": 9.0},
                {"type": "video", "video_id": 7, "in": 0.0, "out": 1.0,
                 "track": "AI", "timeline_start": 0.0},
            ],
        }

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _exportar(self, destino, **kw):
        kw.setdefault("gerar_relatorio", False)
        return exportar_stems(
            self.seq, destino,
            resolver_caminho=lambda vid: self.caminhos.get(vid),
            resolver_nome=lambda vid: self.nomes.get(vid, f"video_{vid}"),
            **kw,
        )

    def test_exporta_48k24_sem_tratamento_e_dedupe_vinculo(self):
        res = self._exportar(self.tmp / "stems_a")
        nomes = sorted(p.name for p in res["stems"])
        # Par vinculado (V1+A1 do mesmo corte) vira UM stem; foto e pista de IA pulados.
        self.assertEqual(nomes, ["stem_v7_000001000-000003500.wav",
                                 "stem_v7_000005000-000006000.wav",
                                 "stem_v8_000000000-000002000.wav"])
        self.assertEqual(len(res["ignorados"]), 2)  # foto + pista de IA
        probe = _probe(self.tmp / "stems_a" / "stem_v7_000001000-000003500.wav")
        stream = probe["streams"][0]
        self.assertEqual(stream["codec_name"], CODEC_PCM)          # 24 bits, sem tratamento
        self.assertEqual(int(stream["sample_rate"]), TAXA_AMOSTRAGEM)
        self.assertEqual(int(stream["bits_per_sample"]), 24)
        self.assertEqual(int(stream["channels"]), 2)               # canais preservados
        dur = float(probe["format"]["duration"])
        self.assertAlmostEqual(dur, 2.5, delta=0.02)               # duracao do corte
        self.assertAlmostEqual(float(stream["duration"]), dur, delta=0.01)

    def test_duracao_do_arquivo_bate_com_o_timecode_do_nome(self):
        res = self._exportar(self.tmp / "stems_b")
        for stem in res["stems"]:
            vid, in_s, out_s = parse_nome_stem(stem.name)
            dur_nome = out_s - in_s
            dur_arq = float(_probe(stem)["format"]["duration"])
            self.assertAlmostEqual(dur_arq, dur_nome, delta=0.02, msg=stem.name)

    def test_trilhas_filtra_por_pista(self):
        res = self._exportar(self.tmp / "stems_c", trilhas=["A1"])
        # Na A1 ficam os dois cortes do v7 e o clipe do v8; nada da V1/AI.
        self.assertEqual(sorted(p.name for p in res["stems"]),
                         ["stem_v7_000001000-000003500.wav",
                          "stem_v7_000005000-000006000.wav",
                          "stem_v8_000000000-000002000.wav"])
        res_vazio = exportar_stems(
            self.seq, self.tmp / "stems_d", gerar_relatorio=False, trilhas=["A9"],
            resolver_caminho=lambda vid: self.caminhos.get(vid))
        self.assertEqual(res_vazio["stems"], [])

    def test_relatorio_vai_junto_por_padrao(self):
        # Default DO MODULO (sem passar o flag): relatorio sai junto.
        res = exportar_stems(
            self.seq, self.tmp / "stems_e",
            resolver_caminho=lambda vid: self.caminhos.get(vid),
            resolver_nome=lambda vid: self.nomes.get(vid, f"video_{vid}"))
        self.assertIsNotNone(res["relatorio"])
        self.assertTrue(res["relatorio"].exists())
        self.assertEqual(res["relatorio"].name, "relatorio_efeitos.txt")
        res_sem = exportar_stems(
            self.seq, self.tmp / "stems_f", gerar_relatorio=False,
            resolver_caminho=lambda vid: self.caminhos.get(vid))
        self.assertIsNone(res_sem["relatorio"])


class TestRelatorioEfeitos(unittest.TestCase):

    def setUp(self):
        self.tmp = _nova_pasta("stem_rel_")
        self.nomes = {7: "Entrevista Julia", 9: "Ambiencia feira", 11: "Clipe limpo"}
        self.seq = {
            "version": 2, "fps": 24.0,
            "tracks": [{"id": "A1", "kind": "audio"}],
            "clips": [
                {"type": "video", "video_id": 7, "in": 405.5, "out": 415.5,
                 "track": "A1", "timeline_start": 12.0,
                 "effects": [
                     {"type": "transform", "x": 10},                      # nao e Tipo A
                     {"type": "audio_eq", "hpf": 80, "low": -2.5, "mid": 1.5, "high": 3},
                     {"type": "audio_dynamics", "gate_db": -45, "comp_ratio": 2.0,
                      "comp_thresh_db": -18, "makeup_db": 3},
                 ]},
                {"type": "video", "video_id": 9, "in": 0.0, "out": 8.0,
                 "track": "A1", "timeline_start": 22.0,
                 "effects": [{"type": "volume", "gain": 0.8}]},           # nenhum Tipo A
                {"type": "video", "video_id": 11, "in": 30.0, "out": 38.0,
                 "track": "A1", "timeline_start": 30.0,
                 "effects": [{"type": "audio_eq", "hpf": 60, "low": 0, "mid": 0,
                              "high": 0, "disabled": True}]},             # Tipo A bypassado
            ],
        }

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _texto(self, **kw):
        destino = self.tmp / kw.pop("destino", "rel")
        caminho = relatorio_efeitos(self.seq, destino, resolver_nome=lambda vid: self.nomes[vid], **kw)
        return caminho, caminho.read_text(encoding="cp1252")

    def test_clipe_sem_tipo_a_nao_polui_o_arquivo(self):
        _, texto = self._texto()
        self.assertNotIn("Ambiencia feira", texto)

    def test_clipe_com_dois_efeitos_mostra_todos_os_parametros(self):
        _, texto = self._texto()
        self.assertIn("CLIPE: Entrevista Julia", texto)
        self.assertIn("Origem: 00:06:45.500 a 00:06:55.500", texto)
        self.assertIn("Posicao na timeline: 00:00:12.000 a 00:00:22.000", texto)
        for fragmento in ["audio_eq", "HPF (corte de graves): 80 Hz",
                          "Graves (low shelf): -2.5 dB", "Medios (peak): 1.5 dB",
                          "Agudos (high shelf): 3 dB", "audio_dynamics",
                          "Gate (limiar): -45 dB", "razao 2:1",
                          "limiar -18 dB", "makeup): 3 dB"]:
            self.assertIn(fragmento, texto)

    def test_efeito_bypassado_fica_declarado_como_bypassado(self):
        _, texto = self._texto()
        self.assertIn("Clipe limpo", texto)
        self.assertIn("[BYPASSADO - NAO aplicar]", texto)

    def test_cp1252_estrito_sem_caracteres_exoticos(self):
        caminho, texto = self._texto()
        bruto = caminho.read_bytes()
        bruto.decode("cp1252", errors="strict")  # nao pode levantar
        self.assertNotIn("→", texto)
        self.assertNotIn("≤", texto)
        self.assertNotIn("−", texto)  # sinal de menos Unicode (U+2212)

    def test_sequencia_sem_tipo_a_gera_arquivo_vazio_declarado(self):
        seq_limpa = {"version": 2, "fps": 24.0, "tracks": [],
                     "clips": [{"type": "video", "video_id": 11, "in": 0.0, "out": 1.0,
                                "track": "A1", "timeline_start": 0.0}]}
        caminho = relatorio_efeitos(seq_limpa, self.tmp / "vazio",
                                    resolver_nome=lambda vid: "Clipe limpo")
        texto = caminho.read_text(encoding="cp1252")
        self.assertIn("Nenhum clipe desta sequencia tem efeito de Tipo A", texto)

    def test_nao_sobrescreve_sem_pedido(self):
        relatorio_efeitos(self.seq, self.tmp / "dup", resolver_nome=lambda vid: self.nomes[vid])
        with self.assertRaises(FileExistsError):
            relatorio_efeitos(self.seq, self.tmp / "dup", resolver_nome=lambda vid: self.nomes[vid])


@unittest.skipUnless(ARQUIVO_REAL.exists() and FFMPEG and FFPROBE,
                     "acervo real ou ffmpeg/ffprobe indisponiveis nesta maquina")
class TesteRealAcervo(unittest.TestCase):
    """Prova de fogo: 10 s do acervo em F:/ -> stem 48 kHz / 24 bits fora do F:."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = _nova_pasta("stem_real_")  # dentro do workspace, fora do F:

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_10_segundos_do_acervo_saem_48k24(self):
        seq = {
            "version": 2, "fps": 24.0,
            "tracks": [{"id": "A1", "kind": "audio"}],
            "clips": [{"type": "video", "video_id": 1, "in": 10.0, "out": 20.0,
                       "track": "A1", "timeline_start": 0.0}],
        }
        res = exportar_stems(
            seq, self.tmp / "daw", gerar_relatorio=False,
            resolver_caminho=lambda vid: ARQUIVO_REAL,
            resolver_nome=lambda vid: "entrevista-arte-julia-e-virshna",
        )
        self.assertEqual(len(res["stems"]), 1, f"ignorados: {res['ignorados']}")
        stem = res["stems"][0]
        self.assertEqual(stem.name, "stem_v1_000010000-000020000.wav")
        probe = _probe(stem)
        stream = probe["streams"][0]
        print("\n[FFPROBE acervo real]")
        print(json.dumps({
            "arquivo": stem.name,
            "codec_name": stream["codec_name"],
            "sample_rate": stream["sample_rate"],
            "bits_per_sample": stream.get("bits_per_sample"),
            "channels": stream["channels"],
            "duration": probe["format"]["duration"],
            "size_bytes": probe["format"]["size"],
        }, indent=2))
        self.assertEqual(stream["codec_name"], "pcm_s24le")
        self.assertEqual(int(stream["sample_rate"]), 48000)
        self.assertEqual(int(stream.get("bits_per_sample", 0)), 24)
        self.assertAlmostEqual(float(probe["format"]["duration"]), 10.0, delta=0.05)
        self.assertLess(float(probe["format"]["size"]), 10 * 48000 * 4 * 2)  # < 10 s estereo 24b
        # Pasta de destino realmente fora do F:
        self.assertNotEqual(stem.resolve().drive.upper(), "F:")


if __name__ == "__main__":
    unittest.main()
