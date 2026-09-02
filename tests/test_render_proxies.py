"""Testes unitários para exportação de vídeo com proxies (midia, fidelidade, preflight e saida)."""
import unittest
from pathlib import Path
from unittest.mock import patch

from src.export.video_render import modelo, midia, fidelidade
from src.api.routes import narrative


def _criar_seq_mock():
    return modelo.normalizar({
        "version": 2, "fps": 24.0, "width": 1920, "height": 1080,
        "tracks": [{"id": "V1", "name": "Video 1", "kind": "video", "order": 0}],
        "clips": [
            {"id": "cut_1", "type": "video", "video_id": 101, "track": "V1", "in": 0.0, "out": 5.0, "timeline_start": 0.0},
            {"id": "cut_2", "type": "video", "video_id": 102, "track": "V1", "in": 2.0, "out": 8.0, "timeline_start": 5.0}
        ]
    })


class TestRenderProxies(unittest.TestCase):

    def test_resolver_fontes_com_usar_proxies(self):
        seq = _criar_seq_mock()
        pedido = modelo.Pedido(timeline_id=1, kind="master", usar_proxies=True)

        # Mock de banco que devolve caminhos de originais (em F:) e checagem de disco
        def mock_buscar_midia(tipo, midia_id):
            return {"filepath": f"F:/originals/video_{midia_id}.mp4"}

        # Simula que o drive F: está desconectado (False)
        def mock_checar_drive(letra):
            return letra != "F"

        # Simula que os proxies locais existem
        with patch("src.export.video_render.midia._arquivo_existe_local", return_value=True):
            rel = midia.resolver_fontes(
                seq, pedido,
                buscar_midia=mock_buscar_midia,
                checar_drive=mock_checar_drive
            )

        # Deve usar proxies, não recusar o render e listar os clipes de proxy
        self.assertFalse(rel.recusado, f"Render não deveria ser recusado: {rel.recusas}")
        self.assertTrue(rel.usa_proxies)
        self.assertEqual(len(rel.clipes_proxy), 2)
        self.assertIn("cut_1", rel.clipes_proxy)
        self.assertIn("cut_2", rel.clipes_proxy)
        self.assertEqual(rel.fontes["cut_1"].classe, "proxy")
        self.assertEqual(rel.fontes["cut_2"].classe, "proxy")

    def test_fidelidade_avisa_sobre_proxies_sem_bloquear(self):
        seq = _criar_seq_mock()
        pedido = modelo.Pedido(timeline_id=1, kind="master", usar_proxies=True)

        rel_midia = midia.RelatorioMidia(
            kind_render="master",
            usa_proxies=True,
            clipes_proxy=["cut_1", "cut_2"]
        )

        rel_fid = fidelidade.relatorio(seq, pedido, rel_midia)

        # Não deve haver aviso bloqueante
        bloqueios = [a for a in rel_fid.get("avisos", []) if a.get("nivel") == "block"]
        self.assertEqual(len(bloqueios), 0)

        # Deve conter aviso warn informativo sobre proxies
        avisos_proxy = [a for a in rel_fid.get("avisos", []) if a.get("codigo") == "RENDER_COM_PROXIES"]
        self.assertEqual(len(avisos_proxy), 1)
        self.assertIn("PROXIES", avisos_proxy[0]["titulo"])

    def test_resolver_saida_adiciona_sufixo_proxy(self):
        pedido = modelo.Pedido(timeline_id=5, usar_proxies=True)
        saida = narrative._resolver_saida(pedido, "Documentario_Talho")

        self.assertIn("_proxy", saida["nome_arquivo_sugerido"])
        self.assertTrue(saida["nome_arquivo_sugerido"].endswith(".mp4"))


if __name__ == "__main__":
    unittest.main()
