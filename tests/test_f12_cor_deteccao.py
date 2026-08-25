"""Testes da Fase 0 do gerenciamento de cor (docs/PLANO_COR_OCIO.md).

- get_media_metadata devolve as chaves de cor SEMPRE (inclusive no caminho de erro)
- deteccao resolve perfil e range sem inventar tag crua
- as colunas da Fase 0.2 migram em banco novo e em banco antigo
- a regra do 'humano': reauditoria nao apaga perfil escolhido a mao
"""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.color import deteccao
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.db.schema import init_db
from src.media.ffmpeg import COLOR_KEYS, EMPTY_COLOR, get_media_metadata


class TestContratoFFprobe(unittest.TestCase):
    """As chaves de cor precisam existir sempre: quem consome nao usa .get() defensivo."""

    def test_caminho_de_erro_traz_todas_as_chaves(self):
        meta = get_media_metadata(Path("nao/existe/arquivo.mov"))
        for chave in COLOR_KEYS:
            self.assertIn(chave, meta, f"chave de cor '{chave}' sumiu no caminho de erro")
            self.assertIsNone(meta[chave])
        # E os campos antigos continuam intactos (nenhum chamador quebra).
        self.assertEqual(meta["duration"], 0.0)
        self.assertEqual(meta["codec"], "unknown")

    def test_empty_color_cobre_o_contrato(self):
        self.assertEqual(set(EMPTY_COLOR), set(COLOR_KEYS))


class TestResolucaoDePerfil(unittest.TestCase):

    def test_tag_bt709_vira_rec709_com_origem_tag(self):
        perfil, origem = deteccao.resolver_perfil({"color_transfer": "bt709"})
        self.assertEqual((perfil, origem), ("rec709", "tag"))

    def test_sem_tag_nenhuma_cai_para_rec709_MAS_declara_que_caiu(self):
        """O caso dos 262 arquivos do acervo (.MTS + .mp4) que nao etiquetam nada."""
        perfil, origem = deteccao.resolver_perfil({"pix_fmt": "yuv420p"})
        self.assertEqual(perfil, "rec709")
        self.assertEqual(origem, "ausente", "silencio nao pode virar afirmacao")

    def test_transferencia_desconhecida_nao_vira_rec709(self):
        perfil, origem = deteccao.resolver_perfil({"color_transfer": "algo-que-nao-existe"})
        self.assertEqual(perfil, "desconhecido")
        self.assertEqual(origem, "tag")

    def test_hdr(self):
        self.assertEqual(deteccao.resolver_perfil({"color_transfer": "smpte2084"})[0], "pq")
        self.assertEqual(deteccao.resolver_perfil({"color_transfer": "arib-std-b67"})[0], "hlg")

    def test_perfis_resolvidos_estao_no_vocabulario_fechado(self):
        for entrada in ({"color_transfer": "bt709"}, {"color_transfer": "xyz"},
                        {"pix_fmt": "yuv420p"}, {"color_primaries": "bt2020"}):
            self.assertIn(deteccao.resolver_perfil(entrada)[0], deteccao.PERFIS_CONHECIDOS)


class TestResolucaoDeRange(unittest.TestCase):

    def test_tag_explicita_ganha(self):
        self.assertEqual(deteccao.resolver_range({"color_range": "pc"}), ("pc", "tag"))
        self.assertEqual(deteccao.resolver_range({"color_range": "tv"}), ("tv", "tag"))

    def test_yuvj_sem_tag_e_full_range(self):
        """Convencao do proprio FFmpeg -- e a que ja governa os proxies no disco."""
        self.assertEqual(deteccao.resolver_range({"pix_fmt": "yuvj420p"}), ("pc", "pix_fmt"))

    def test_silencio_total_e_limitado(self):
        self.assertEqual(deteccao.resolver_range({"pix_fmt": "yuv420p"}), ("tv", "ausente"))


class TestResolverNaoInventaTagCrua(unittest.TestCase):

    def test_tag_ausente_permanece_none(self):
        bloco = deteccao.resolver({"pix_fmt": "yuv420p", "field_order": "tt"})
        self.assertIsNone(bloco["color_range"], "tag crua nao pode ser preenchida por inferencia")
        self.assertIsNone(bloco["color_transfer"])
        self.assertEqual(bloco["color_profile"], "rec709")
        self.assertEqual(bloco["color_profile_origem"], "ausente")

    def test_entrelacado(self):
        self.assertTrue(deteccao.e_entrelacado({"field_order": "tt"}))
        self.assertFalse(deteccao.e_entrelacado({"field_order": "progressive"}))
        self.assertFalse(deteccao.e_entrelacado({}))


class TestFotos(unittest.TestCase):

    def test_extensao_raw_vira_perfil_raw(self):
        for ext in (".cr2", ".CR2", ".nef", ".dng", ".arw"):
            bloco = deteccao.resolver_foto(f"/acervo/foto{ext}")
            self.assertEqual(bloco["color_profile"], "raw", ext)
            self.assertEqual(bloco["color_profile_origem"], "extensao")

    def test_arquivo_ilegivel_nao_levanta(self):
        bloco = deteccao.resolver_foto("/nao/existe/foto.jpg")
        self.assertEqual(bloco["color_profile"], "desconhecido")
        self.assertEqual(bloco["color_profile_origem"], "ausente")


class TestMigracaoEGravacao(unittest.TestCase):

    def setUp(self):
        self.db = Path(tempfile.mkdtemp()) / "cor.db"
        init_db(self.db)

    def _colunas(self, tabela):
        with get_db(self.db) as conn:
            return [r[1] for r in conn.execute(f"PRAGMA table_info({tabela})")]

    def test_colunas_da_fase_0_existem(self):
        video = self._colunas("video")
        for c in ("color_range", "color_space", "color_transfer", "color_primaries",
                  "pix_fmt", "field_order", "color_profile", "color_profile_origem",
                  "proxy_color_range", "proxy_pix_fmt", "color_auditado_em"):
            self.assertIn(c, video, f"coluna '{c}' nao migrou em video")
        foto = self._colunas("photo")
        for c in ("color_profile", "color_profile_origem", "raw_params_json",
                  "color_auditado_em"):
            self.assertIn(c, foto, f"coluna '{c}' nao migrou em photo")

    def test_migracao_e_idempotente(self):
        init_db(self.db)
        init_db(self.db)
        self.assertIn("color_profile", self._colunas("video"))

    def _novo_video(self, conn):
        pid = conn.execute("SELECT id FROM project LIMIT 1").fetchone()["id"]
        return MediaRepository.add_video(conn, project_id=pid, filename="a.mov",
                                         filepath="/x/a.mov", file_hash="hash-teste")

    def test_gravacao_carimba_auditoria(self):
        with get_db(self.db) as conn:
            vid = self._novo_video(conn)
            self.assertTrue(MediaRepository.update_video_color(
                conn, vid, {"color_profile": "rec709", "color_profile_origem": "tag"}))
            row = conn.execute(
                "SELECT color_profile, color_auditado_em FROM video WHERE id=?", (vid,)).fetchone()
            self.assertEqual(row["color_profile"], "rec709")
            self.assertIsNotNone(row["color_auditado_em"])

    def test_reauditoria_preserva_perfil_do_humano_mas_atualiza_tag_crua(self):
        """A promessa do modulo: correcao manual nao pode ser apagada por uma
        releitura automatica -- e foi para nao perder trabalho humano em silencio
        que este plano existe. Mas a tag CRUA e fato do arquivo, nao opiniao:
        essa continua sendo atualizada."""
        with get_db(self.db) as conn:
            vid = self._novo_video(conn)
            MediaRepository.update_video_color(conn, vid, {
                "color_profile": "rec709", "color_profile_origem": "tag", "color_range": "pc"})
            MediaRepository.update_video_color(conn, vid, {
                "color_profile": "slog3", "color_profile_origem": "humano"})

            MediaRepository.update_video_color(conn, vid, {
                "color_profile": "rec709", "color_profile_origem": "tag",
                "color_range": "tv", "pix_fmt": "yuv420p"})

            row = conn.execute("SELECT color_profile, color_profile_origem, color_range, "
                               "pix_fmt FROM video WHERE id=?", (vid,)).fetchone()
            self.assertEqual(row["color_profile"], "slog3")
            self.assertEqual(row["color_profile_origem"], "humano")
            self.assertEqual(row["color_range"], "tv")
            self.assertEqual(row["pix_fmt"], "yuv420p")

    def test_humano_sobrescreve_humano(self):
        with get_db(self.db) as conn:
            vid = self._novo_video(conn)
            MediaRepository.update_video_color(conn, vid, {
                "color_profile": "slog3", "color_profile_origem": "humano"})
            MediaRepository.update_video_color(conn, vid, {
                "color_profile": "logc3", "color_profile_origem": "humano"})
            self.assertEqual(conn.execute(
                "SELECT color_profile FROM video WHERE id=?", (vid,)).fetchone()["color_profile"],
                "logc3")

    def test_chave_fora_da_whitelist_e_ignorada(self):
        """O nome da coluna entra no SQL por f-string: a whitelist e a defesa."""
        with get_db(self.db) as conn:
            vid = self._novo_video(conn)
            self.assertFalse(MediaRepository.update_video_color(conn, vid, {}))
            self.assertFalse(MediaRepository.update_video_color(
                conn, vid, {"status": "error", "title": "invadido"}))
            row = conn.execute("SELECT status, title FROM video WHERE id=?", (vid,)).fetchone()
            self.assertEqual(row["status"], "ingested")
            self.assertIsNone(row["title"])


if __name__ == "__main__":
    unittest.main()
