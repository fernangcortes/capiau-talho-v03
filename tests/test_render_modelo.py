"""Testes do contrato do modelo de render (as oito regras de paridade P1-P8).

O que esta em jogo: `modelo.py` e o unico lugar onde as regras que o player
aplica implicitamente viram regra explicita. Se uma delas quebrar aqui, o render
sai diferente da tela e ninguem percebe ate ver o arquivo final.

A regra mais sutil e a P4 (sobreposicao). Ela tem uma parte que quase todo mundo
erra: aparar o comeco de um clipe NA TIMELINE obriga a avancar o mesmo tanto
DENTRO DA MIDIA. Sem isso o trecho exibido nao e o que estava na tela.
"""
import unittest

from src.export.video_render import modelo


def _seq(**extra):
    """Sequencia v2 minima, no formato que o banco grava."""
    base = {
        "version": 2, "fps": 25.0, "width": 1920, "height": 1080,
        "tracks": [
            {"id": "AI", "kind": "ai", "order": 0},
            {"id": "V2", "kind": "video", "order": 1},
            {"id": "V1", "kind": "video", "order": 2},
            {"id": "A1", "kind": "audio", "order": 3, "volume": 0.8},
        ],
        "clips": [],
    }
    base.update(extra)
    return base


def _clipe(cid, track, ini, in_s, out_s, **extra):
    d = {"id": cid, "type": "video", "video_id": 1, "track": track,
         "in": in_s, "out": out_s, "timeline_start": ini}
    d.update(extra)
    return d


class TestNormalizacao(unittest.TestCase):

    def test_propriedades_da_timeline(self):
        s = modelo.normalizar(_seq(fps=30.0, width=1280, height=720))
        self.assertEqual((s.fps, s.largura, s.altura), (30.0, 1280, 720))

    def test_defaults_quando_falta_tudo(self):
        s = modelo.normalizar({"version": 2})
        self.assertEqual((s.fps, s.largura, s.altura),
                         (modelo.FPS_PADRAO, modelo.LARGURA_PADRAO, modelo.ALTURA_PADRAO))

    def test_valores_invalidos_caem_no_default(self):
        """fps 0 ou negativo destruiria toda a conversao de tempo."""
        s = modelo.normalizar(_seq(fps=0, width=-10))
        self.assertEqual(s.fps, modelo.FPS_PADRAO)
        self.assertEqual(s.largura, modelo.LARGURA_PADRAO)

    def test_lista_v1_legada_e_aceita(self):
        s = modelo.normalizar([_clipe("a", "V1", 0.0, 0.0, 3.0)])
        self.assertEqual(len(s.clipes), 1)

    def test_clipe_de_duracao_zero_ou_invertida_some(self):
        """Corte que nao existe na tela nao pode virar entrada de ffmpeg."""
        s = modelo.normalizar(_seq(clips=[
            _clipe("zero", "V1", 0.0, 5.0, 5.0),
            _clipe("invertido", "V1", 0.0, 9.0, 4.0),
            _clipe("bom", "V1", 0.0, 1.0, 4.0),
        ]))
        self.assertEqual([c.id for c in s.clipes], ["bom"])

    def test_frames_da_tela_sao_recusados_com_mensagem(self):
        """Payload em frames sem fps junto seria convertido chutando 24 fps.

        Explodir e melhor: um chute de fps desalinha a timeline inteira em
        silencio, e o usuario so descobre vendo o video fora de sincronia.
        """
        with self.assertRaises(ValueError):
            modelo.normalizar(_seq(clips=[
                {"id": "a", "track": "V1", "in": 0, "out": 2, "timelineStartFrame": 50}
            ]))

    def test_ordem_das_pistas_sem_campo_order(self):
        """Sem `order` explicito, vale a posicao no array (ordem visual)."""
        s = modelo.normalizar({"version": 2, "tracks": [
            {"id": "TOPO", "kind": "video"}, {"id": "MEIO", "kind": "video"},
            {"id": "FUNDO", "kind": "video"}]})
        self.assertEqual([p.id for p in s.pistas_video()], ["TOPO", "MEIO", "FUNDO"])


class TestRegrasDeParidade(unittest.TestCase):

    def test_p1_pista_de_ia_fora_da_duracao(self):
        """Sugestao nao aceita nao estica o render (mesma regra do export OTIO)."""
        s = modelo.normalizar(_seq(clips=[
            _clipe("real", "V1", 0.0, 0.0, 2.0),
            _clipe("ghost", "AI", 0.0, 0.0, 60.0),
        ]))
        self.assertEqual(s.duracao_s(), 2.0)

    def test_p2_p3_separacao_de_pistas(self):
        s = modelo.normalizar(_seq())
        self.assertEqual([p.id for p in s.pistas_video()], ["V2", "V1"])
        self.assertEqual([p.id for p in s.pistas_audio()], ["A1"])
        self.assertTrue(s.pista("AI").e_ia)

    def test_p4_primeiro_do_array_vence_e_a_midia_acompanha(self):
        """O player usa `cuts.find()`: vence o de menor indice, nao o mais recente.

        E, ao aparar 2 s do comeco de `b` na timeline, o `in_s` dele tem de
        avancar os mesmos 2 s dentro da midia (100 -> 102). Sem isso o trecho
        exibido nao e o que estava na tela.
        """
        s = modelo.normalizar(_seq(clips=[
            _clipe("a", "V1", 0.0, 10.0, 14.0),     # timeline 0-4
            _clipe("b", "V1", 2.0, 100.0, 106.0),   # timeline 2-8, perde a sobreposicao
        ]))
        resolvidos = s.clipes_da_pista("V1")
        self.assertEqual(len(resolvidos), 2)
        self.assertEqual((resolvidos[0].inicio_s, resolvidos[0].fim_s), (0.0, 4.0))
        self.assertEqual((resolvidos[1].inicio_s, resolvidos[1].fim_s), (4.0, 8.0))
        self.assertEqual(resolvidos[1].in_s, 102.0)
        self.assertEqual(resolvidos[1].out_s, 106.0)

    def test_p4_clipe_partido_ao_meio(self):
        """Vencedor no MEIO de outro parte o perdedor em dois pedacos."""
        s = modelo.normalizar(_seq(clips=[
            _clipe("meio", "V1", 4.0, 50.0, 52.0),   # indice 0: timeline 4-6
            _clipe("longo", "V1", 0.0, 0.0, 10.0),   # indice 1: timeline 0-10
        ]))
        r = s.clipes_da_pista("V1")
        self.assertEqual([(c.inicio_s, c.fim_s) for c in r],
                         [(0.0, 4.0), (4.0, 6.0), (6.0, 10.0)])
        # O pedaco da direita comeca em 6 s de timeline => 6 s dentro da midia.
        direita = r[2]
        self.assertEqual(direita.in_s, 6.0)
        self.assertEqual(direita.out_s, 10.0)

    def test_p4_clipe_totalmente_coberto_some(self):
        s = modelo.normalizar(_seq(clips=[
            _clipe("cobre", "V1", 0.0, 0.0, 10.0),
            _clipe("coberto", "V1", 2.0, 0.0, 3.0),
        ]))
        self.assertEqual([c.id for c in s.clipes_da_pista("V1")], ["cobre"])

    def test_p4_nao_mexe_em_clipes_que_nao_encostam(self):
        """Clipe sem sobreposicao tem de sair com id e tempos intactos."""
        s = modelo.normalizar(_seq(clips=[
            _clipe("a", "V1", 0.0, 0.0, 2.0),
            _clipe("b", "V1", 5.0, 0.0, 2.0),
        ]))
        r = s.clipes_da_pista("V1")
        self.assertEqual([c.id for c in r], ["a", "b"])
        self.assertEqual([(c.inicio_s, c.in_s) for c in r], [(0.0, 0.0), (5.0, 0.0)])

    def test_p5_disabled_e_bypass(self):
        s = modelo.normalizar(_seq(clips=[
            _clipe("a", "V1", 0.0, 0.0, 2.0, effects=[
                {"type": "color", "saturation": 0, "disabled": True},
                {"type": "volume", "level": 0.5},
            ]),
        ]))
        c = s.clipes[0]
        self.assertIsNone(c.efeito("color"))
        self.assertIsNotNone(c.efeito("color", incluir_bypass=True))
        self.assertEqual(c.efeito("volume")["level"], 0.5)

    def test_efeitos_multiplos_do_mesmo_tipo(self):
        """Crossfade tem dois: um de entrada e um de saida."""
        s = modelo.normalizar(_seq(clips=[
            _clipe("a", "V1", 0.0, 0.0, 5.0, effects=[
                {"type": "crossfade", "side": "in", "duration_s": 0.5},
                {"type": "crossfade", "side": "out", "duration_s": 0.8},
                {"type": "crossfade", "side": "out", "duration_s": 9, "disabled": True},
            ]),
        ]))
        self.assertEqual(len(s.clipes[0].efeitos("crossfade")), 2)
        self.assertEqual(len(s.clipes[0].efeitos("crossfade", incluir_bypass=True)), 3)

    def test_p6_ken_burns_marcado_so_em_foto(self):
        """O modelo nao filtra por si: quem consome checa `e_foto` (player.js:2190)."""
        s = modelo.normalizar(_seq(clips=[
            {"id": "f", "type": "photo", "photo_id": 3, "track": "V1",
             "in": 0, "out": 5, "timeline_start": 0},
        ]))
        self.assertTrue(s.clipes[0].e_foto)
        self.assertIsNone(s.clipes[0].video_id)
        self.assertEqual(s.clipes[0].photo_id, 3)

    def test_p7_p8_hidden_e_locked_sao_so_metadado(self):
        """Nem hidden nem locked removem a pista do modelo: quem decide e o escopo."""
        s = modelo.normalizar(_seq(tracks=[
            {"id": "V1", "kind": "video", "hidden": True, "locked": True},
        ]))
        self.assertEqual(len(s.pistas_video()), 1)
        self.assertTrue(s.pista("V1").hidden)
        self.assertTrue(s.pista("V1").locked)


class TestEscopo(unittest.TestCase):
    """Escopo = escolha do editor. Ausencia de chave significa LIGADO."""

    def test_tudo_ligado_por_padrao(self):
        e = modelo.Escopo()
        for categoria in modelo.CATEGORIAS:
            self.assertTrue(e.categoria_ligada(categoria))
        self.assertTrue(e.pista_ligada("qualquer_uma"))
        self.assertTrue(e.efeito_ligado("color"))

    def test_desligar_categoria_desliga_seus_efeitos(self):
        e = modelo.Escopo(categorias={"motion": False})
        for tipo in ("fit", "transform", "crop", "ken_burns"):
            self.assertFalse(e.efeito_ligado(tipo), f"{tipo} deveria estar desligado")
        self.assertTrue(e.efeito_ligado("color"))
        self.assertTrue(e.efeito_ligado("crossfade"))

    def test_categoria_de_audio(self):
        e = modelo.Escopo(categorias={"audio_fx": False})
        for tipo in ("audio_eq", "audio_dynamics", "volume"):
            self.assertFalse(e.efeito_ligado(tipo))

    def test_efeito_sem_categoria_dona_segue_ligado(self):
        """`audio_render` nao e categoria de escopo: e troca de fonte, nao efeito."""
        e = modelo.Escopo(categorias={c: False for c in modelo.CATEGORIAS})
        self.assertTrue(e.efeito_ligado("audio_render"))


class TestFaixa(unittest.TestCase):

    def test_completa_cobre_a_timeline(self):
        self.assertEqual(modelo.Faixa().resolver(12.5), (0.0, 12.5))

    def test_in_out_e_preso_na_duracao(self):
        f = modelo.Faixa(modo=modelo.MODO_FAIXA_IN_OUT, inicio_s=2.0, fim_s=999.0)
        self.assertEqual(f.resolver(10.0), (2.0, 10.0))

    def test_in_out_invertido_explode(self):
        f = modelo.Faixa(modo=modelo.MODO_FAIXA_IN_OUT, inicio_s=8.0, fim_s=3.0)
        with self.assertRaises(ValueError):
            f.resolver(10.0)

    def test_in_out_depois_do_fim_explode(self):
        f = modelo.Faixa(modo=modelo.MODO_FAIXA_IN_OUT, inicio_s=20.0, fim_s=30.0)
        with self.assertRaises(ValueError):
            f.resolver(10.0)


class TestPedido(unittest.TestCase):

    def test_chave_de_tarefa_e_por_timeline(self):
        """Fila sequencial: uma chave por timeline."""
        self.assertEqual(modelo.Pedido(timeline_id=7).chave_tarefa, "render_timeline_7")

    def test_rascunho(self):
        self.assertTrue(modelo.Pedido(timeline_id=1, kind=modelo.TIPO_DRAFT).e_rascunho)
        self.assertFalse(modelo.Pedido(timeline_id=1).e_rascunho)

    def test_fallback_de_proxy_e_desligado_por_padrao(self):
        """Master nunca cai calado para proxy: a permissao e explicita."""
        self.assertFalse(modelo.Pedido(timeline_id=1).permitir_fallback_proxy)


if __name__ == "__main__":
    unittest.main()
