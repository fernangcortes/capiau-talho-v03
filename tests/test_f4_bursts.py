"""Testes do agrupamento de rajadas de fotos (E2.B4).

Usa CLIP real sobre fixtures sintéticas: uma "rajada" (mesma imagem com ruído leve,
como quadros consecutivos de um disparo contínuo) e uma foto claramente diferente.
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "burst"

SETTINGS = {
    "burst.enabled": True,
    "clip.enabled": True,
    "burst.similarity_threshold": 0.97,
    "burst.time_window_s": 30,
    "burst.max_group_size": 30,
}


def _make_fixtures():
    """3 quadros quase idênticos (ruído leve) + 1 imagem visualmente distinta."""
    from PIL import Image
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(42)

    base = np.zeros((224, 224, 3), dtype=np.uint8)
    base[:120, :, 0] = 200          # faixa vermelha em cima
    base[120:, :, 2] = 180          # faixa azul embaixo
    for i in range(3):
        noisy = np.clip(base.astype(np.int16) + rng.integers(-6, 7, base.shape), 0, 255).astype(np.uint8)
        Image.fromarray(noisy).save(FIXTURE_DIR / f"burst_{i}.png")

    other = np.zeros((224, 224, 3), dtype=np.uint8)
    other[:, :112, 1] = 220         # metade verde
    other[:, 112:, :] = 240         # metade branca
    Image.fromarray(other).save(FIXTURE_DIR / "other.png")


def _photos():
    """Fotos na ordem de encadeamento: 3 da rajada (t=0,1,2s) + 1 distinta (t=3s)."""
    items = [
        {"id": i + 1, "filepath": FIXTURE_DIR / f"burst_{i}.png", "mtime": float(i), "parent_dir": str(FIXTURE_DIR)}
        for i in range(3)
    ]
    items.append({"id": 4, "filepath": FIXTURE_DIR / "other.png", "mtime": 3.0, "parent_dir": str(FIXTURE_DIR)})
    return items


class TestBurstGrouping(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _make_fixtures()

    def _group(self, photos, settings=None):
        merged = {**SETTINGS, **(settings or {})}
        # photo_image_path aponta para o proxy do app; nas fixtures o caminho já é o arquivo
        with patch("src.services.burst_service.SettingsService.get_settings", return_value=merged), \
             patch("src.services.burst_service.photo_image_path", side_effect=lambda pid, fp: fp):
            from src.services.burst_service import group_photo_bursts
            return group_photo_bursts(project_id=1, photos=photos)

    def test_quase_identicas_viram_um_grupo(self):
        groups = self._group(_photos())
        self.assertEqual(len(groups), 2, "3 quadros da rajada + 1 foto distinta = 2 chamadas de visão")
        self.assertEqual(groups[0].size, 3)
        self.assertEqual(groups[0].leader["id"], 1)
        self.assertEqual([m["id"] for m in groups[0].members], [2, 3])
        self.assertEqual(groups[1].size, 1, "foto distinta não entra na rajada")
        self.assertEqual(groups[1].leader["id"], 4)

    def test_janela_de_tempo_separa_rajadas(self):
        photos = _photos()
        photos[2]["mtime"] = 9999.0  # mesmo visual, mas horas depois
        groups = self._group(photos, {"burst.time_window_s": 30})
        self.assertEqual(groups[0].size, 2, "quadro fora da janela abre grupo novo")
        self.assertIn(3, [g.leader["id"] for g in groups])

    def test_pastas_diferentes_nao_agrupam(self):
        photos = _photos()
        photos[1]["parent_dir"] = "/outra/pasta"
        groups = self._group(photos)
        self.assertEqual(groups[0].size, 1, "pasta diferente quebra o encadeamento")

    def test_max_group_size_limita(self):
        groups = self._group(_photos(), {"burst.max_group_size": 2})
        self.assertEqual(groups[0].size, 2)
        self.assertEqual(len(groups), 3, "o 3º quadro vira líder do próprio grupo")

    def test_desligado_analisa_todas(self):
        groups = self._group(_photos(), {"burst.enabled": False})
        self.assertEqual(len(groups), 4)
        self.assertTrue(all(g.size == 1 for g in groups))

    def test_clip_desligado_analisa_todas(self):
        groups = self._group(_photos(), {"clip.enabled": False})
        self.assertEqual(len(groups), 4)


class TestBurstReplication(unittest.TestCase):
    """A líder é analisada; as demais herdam e continuam visíveis na biblioteca."""

    @classmethod
    def setUpClass(cls):
        _make_fixtures()
        from src.config import CONFIG
        from src.db.schema import init_db

        # Diretorio proprio desta execucao, fora da arvore do repositorio
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_burst_"))
        cls._orig_db, cls._orig_proxies = CONFIG.DB_PATH, CONFIG.PROXIES_DIR
        CONFIG.DB_PATH = cls.test_dir / "test_burst.db"
        CONFIG.PROXIES_DIR = cls.test_dir / "proxies"
        (CONFIG.PROXIES_DIR / "photos").mkdir(parents=True, exist_ok=True)
        init_db(CONFIG.DB_PATH)

    @classmethod
    def tearDownClass(cls):
        import shutil
        from src.config import CONFIG
        CONFIG.DB_PATH, CONFIG.PROXIES_DIR = cls._orig_db, cls._orig_proxies
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_membros_herdam_e_continuam_na_biblioteca(self):
        from src.db.operations import add_photo
        from src.db.connection import get_db
        from src.services.burst_service import BurstGroup

        ids = [
            add_photo(project_id=1, filename=f"r{i}.png",
                      filepath=str(FIXTURE_DIR / f"burst_{i}.png"),
                      file_hash=f"hash_burst_{i}")
            for i in range(3)
        ]

        # Estado após a análise da líder pela API de visão
        with get_db() as conn:
            conn.execute(
                """UPDATE photo SET description = ?, raw_description = ?, tags = ?,
                          category = ?, category_confidence = ?, title = ?, status = 'analyzed'
                   WHERE id = ?""",
                ("Equipe montando o trilho no pátio.", "bruto da visão", '["trilho", "equipe"]',
                 "processo", 0.91, "Montagem do trilho", ids[0]),
            )
            conn.commit()

        group = BurstGroup(
            leader={"id": ids[0], "filepath": FIXTURE_DIR / "burst_0.png"},
            members=[{"id": pid, "filepath": FIXTURE_DIR / f"burst_{i}.png", "clip_vector": None}
                     for i, pid in enumerate(ids[1:], start=1)],
        )

        with patch("src.services.burst_service.SettingsService.get_settings", return_value=SETTINGS), \
             patch("src.services.burst_service.SemanticSearch") as mock_sem, \
             patch("src.search.image_semantic.ImageSearch") as mock_img:
            from src.services.burst_service import replicate_to_members
            replicated = replicate_to_members(project_id=1, group=group)

        self.assertEqual(replicated, 2)
        # cada membro entra na busca textual sem nova chamada de visão
        self.assertEqual(mock_sem.get_instance.return_value.index_photo_description.call_count, 2)

        with get_db() as conn:
            rows = {r["id"]: dict(r) for r in conn.execute(
                f"SELECT * FROM photo WHERE id IN ({','.join('?' * len(ids))})", ids).fetchall()}

        self.assertEqual(len(rows), 3, "as 3 fotos continuam na biblioteca")
        self.assertEqual(rows[ids[0]]["burst_group_id"], ids[0], "líder marcada com o próprio id")

        for i, pid in enumerate(ids[1:], start=2):
            member = rows[pid]
            self.assertEqual(member["burst_group_id"], ids[0])
            self.assertEqual(member["category"], "processo")
            self.assertEqual(member["title"], "Montagem do trilho")
            self.assertEqual(member["status"], "analyzed")
            self.assertIn("Equipe montando o trilho", member["description"])
            self.assertIn(f"Quadro {i} de 3", member["description"], "a réplica declara a origem")

    def test_lider_nao_analisada_nao_replica(self):
        from src.db.operations import add_photo
        from src.services.burst_service import BurstGroup, replicate_to_members

        pending = add_photo(project_id=1, filename="p0.png",
                            filepath=str(FIXTURE_DIR / "burst_0.png"), file_hash="hash_pend_0")
        member = add_photo(project_id=1, filename="p1.png",
                           filepath=str(FIXTURE_DIR / "burst_1.png"), file_hash="hash_pend_1")
        group = BurstGroup(leader={"id": pending, "filepath": FIXTURE_DIR / "burst_0.png"},
                           members=[{"id": member, "filepath": FIXTURE_DIR / "burst_1.png"}])

        with patch("src.services.burst_service.SettingsService.get_settings", return_value=SETTINGS):
            self.assertEqual(replicate_to_members(project_id=1, group=group), 0)


if __name__ == "__main__":
    unittest.main()
