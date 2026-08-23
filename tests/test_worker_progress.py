"""Testes do progresso por tipo de worker e da guarda de instância única (B1/B2, 22/08/2026):
- Um arquivo de progresso por worker: com um só, visão e transcrição apagavam as
  entradas um do outro, porque cada um grava o snapshot INTEIRO do seu progresso.
- Colisão de chave: os dois usam str(video_id) (src/services/pipeline.py:349 e :649).
- PID: base da recusa de segundo worker do mesmo tipo.

Ver docs/PLANO_HISTORICO_METADADOS_E_WORKER_ASR.md.
Tudo em diretório temporário. Nenhum teste aqui toca Qdrant, ASR ou o banco.
"""
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path

from src.core import tasks


class TestWorkerProgress(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="capiau_worker_progress_"))
        self.original_dir = tasks.WORKER_LOGS_DIR
        tasks.WORKER_LOGS_DIR = self.dir

    def tearDown(self):
        tasks.WORKER_LOGS_DIR = self.original_dir
        shutil.rmtree(self.dir, ignore_errors=True)

    def escrever(self, worker_type, dados):
        caminho = tasks.worker_progress_file(worker_type)
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_text(json.dumps(dados), encoding="utf-8")
        return caminho

    # ── Mesclagem ────────────────────────────────────────────────────────────

    def test_sem_arquivo_devolve_vazio(self):
        self.assertEqual(tasks.read_worker_progress(), {})

    def test_mescla_os_dois_workers(self):
        self.escrever("asr", {"5": {"percent": 10.0, "type": "transcription"}})
        self.escrever("vision", {"77": {"percent": 40.0, "type": "vision"}})

        merged = tasks.read_worker_progress()
        self.assertEqual(set(merged), {"5", "77"})
        self.assertEqual(merged["5"]["type"], "transcription")
        self.assertEqual(merged["77"]["type"], "vision")

    def test_colisao_de_chave_nao_perde_tarefa(self):
        """O mesmo vídeo nos dois workers: o segundo entra sufixado, não some."""
        self.escrever("asr", {"5": {"percent": 10.0, "type": "transcription"}})
        self.escrever("vision", {"5": {"percent": 90.0, "type": "vision"}})

        merged = tasks.read_worker_progress()
        self.assertEqual(len(merged), 2, "as duas tarefas sobrevivem")
        self.assertIn("5", merged)
        self.assertIn("5#vision", merged, "a colisão vira <id>#<tipo>")
        self.assertEqual(merged["5"]["type"], "transcription")
        self.assertEqual(merged["5#vision"]["type"], "vision")

    def test_arquivo_velho_e_ignorado_sem_derrubar_o_outro(self):
        velho = self.escrever("vision", {"77": {"percent": 40.0}})
        antigo = time.time() - (tasks.WORKER_PROGRESS_MAX_AGE_S + 60)
        os.utime(velho, (antigo, antigo))
        self.escrever("asr", {"5": {"percent": 10.0}})

        merged = tasks.read_worker_progress()
        self.assertEqual(set(merged), {"5"}, "rodada morta some, a viva fica")

    def test_json_corrompido_nao_derruba_a_leitura(self):
        tasks.worker_progress_file("vision").write_text("{isso nao e json", encoding="utf-8")
        self.escrever("asr", {"5": {"percent": 10.0}})
        self.assertEqual(set(tasks.read_worker_progress()), {"5"})

    def test_arquivo_legado_nao_entra(self):
        """worker_progress.json (nome antigo, sem tipo) não casa com o padrão novo."""
        (self.dir / "worker_progress.json").write_text(
            json.dumps({"legado": {"percent": 1.0}}), encoding="utf-8"
        )
        self.assertEqual(tasks.read_worker_progress(), {})

    # ── PID / instância única ────────────────────────────────────────────────

    def test_pid_do_proprio_processo_conta_como_rodando(self):
        tasks.write_worker_pid("asr")
        vivo = tasks.worker_is_running("asr")
        self.assertIsNotNone(vivo)
        self.assertEqual(vivo["pid"], os.getpid())
        self.assertEqual(vivo["tipo"], "asr")
        self.assertIn("worker_progress_asr.json", vivo["progress_file"])

    def test_tipos_diferentes_nao_se_bloqueiam(self):
        tasks.write_worker_pid("asr")
        self.assertIsNotNone(tasks.worker_is_running("asr"))
        self.assertIsNone(tasks.worker_is_running("vision"))

    def test_registro_orfao_e_limpo(self):
        """PID morto não pode recusar lançamentos para sempre."""
        tasks.worker_pid_file("asr").parent.mkdir(parents=True, exist_ok=True)
        tasks.worker_pid_file("asr").write_text(
            json.dumps({"pid": 999999, "tipo": "asr", "iniciado_em": time.time()}),
            encoding="utf-8"
        )
        self.assertIsNone(tasks.worker_is_running("asr"))
        self.assertFalse(tasks.worker_pid_file("asr").exists(), "o órfão é apagado")

    def test_registro_ilegivel_e_limpo(self):
        tasks.worker_pid_file("asr").parent.mkdir(parents=True, exist_ok=True)
        tasks.worker_pid_file("asr").write_text("lixo", encoding="utf-8")
        self.assertIsNone(tasks.worker_is_running("asr"))
        self.assertFalse(tasks.worker_pid_file("asr").exists())

    def test_limpeza_do_dono_apaga(self):
        tasks.write_worker_pid("asr")
        tasks.clear_worker_pid("asr", only_if_owner=True)
        self.assertFalse(tasks.worker_pid_file("asr").exists())

    def test_limpeza_de_terceiro_nao_apaga(self):
        """Um --dry-run em paralelo não pode derrubar a guarda de uma rodada real."""
        tasks.write_worker_pid("asr", pid=os.getpid() + 1)
        tasks.clear_worker_pid("asr", only_if_owner=True)
        self.assertTrue(tasks.worker_pid_file("asr").exists(), "registro alheio preservado")

        tasks.clear_worker_pid("asr")  # sem guarda, apaga mesmo assim
        self.assertFalse(tasks.worker_pid_file("asr").exists())

    # -- Espelho em disco: transicao de estado nao pode ser engolida -----------

    def test_mudanca_de_estado_grava_na_hora(self):
        """A trava de 1s do espelho existe para o worker de visao (atualiza a cada
        frame). Mas a transcricao passa MINUTOS sem atualizar: se a virada para
        'running' fosse engolida, a rodada inteira ficaria invisivel na tela."""
        tm = tasks.TASK_MANAGER
        anterior = (dict(tm.progress), tm._sink_path, tm._sink_last_write)
        try:
            tm.progress.clear()
            destino = tasks.worker_progress_file("asr")
            tm.enable_file_sink(destino)  # grava agora e arma a trava de 1s

            # Sem espera: e exatamente a janela em que a trava engolia a atualizacao
            tm.update_progress("13", 0.0, "running", task_type="transcription")
            gravado = json.loads(destino.read_text(encoding="utf-8"))
            self.assertIn("13", gravado, "inicio da tarefa chegou ao arquivo")
            self.assertEqual(gravado["13"]["status"], "running")

            # Percentual sem mudanca de estado continua sob a trava
            tm.update_progress("13", 50.0, "running", task_type="transcription")
            self.assertEqual(
                json.loads(destino.read_text(encoding="utf-8"))["13"]["percent"], 0.0,
                "percentual puro segue amortecido"
            )

            # Fim da tarefa e mudanca de estado: passa direto
            tm.update_progress("13", 100.0, "finished", task_type="transcription")
            gravado = json.loads(destino.read_text(encoding="utf-8"))
            self.assertEqual(gravado["13"]["status"], "finished")
            self.assertEqual(gravado["13"]["percent"], 100.0)
        finally:
            tm.progress.clear()
            tm.progress.update(anterior[0])
            tm._sink_path, tm._sink_last_write = anterior[1], anterior[2]

    def test_process_alive_nao_mata_ninguem(self):
        """No Windows os.kill(pid, 0) MATA o processo; a checagem usa OpenProcess."""
        self.assertTrue(tasks._process_alive(os.getpid()))
        self.assertTrue(tasks._process_alive(os.getpid()), "continuamos vivos após a checagem")
        self.assertFalse(tasks._process_alive(999999))
        self.assertFalse(tasks._process_alive(0))
        self.assertFalse(tasks._process_alive(-1))


class TestQdrantHandoff(unittest.TestCase):
    """Empréstimo da trava do Qdrant ao worker de lote (B2, 22/08/2026).

    O Qdrant embutido aceita um processo por vez. O servidor sempre abre primeiro,
    então sem soltar a trava de propósito o worker roda com client=None e a
    transcrição não entra na busca. Nenhum teste aqui abre o Qdrant de verdade.
    """

    def setUp(self):
        from src.search.semantic import SemanticSearch
        self.cls = SemanticSearch
        self.dir = Path(tempfile.mkdtemp(prefix="capiau_handoff_"))
        self.original_dir = tasks.WORKER_LOGS_DIR
        tasks.WORKER_LOGS_DIR = self.dir

        # Instância crua: sem __init__ não há carga de modelo nem conexão real
        self.s = object.__new__(SemanticSearch)
        self.s._lock = threading.Lock()
        self.s.collection_name = "teste"
        self.s.client = None
        self.s.encoder = object()          # finge modelo carregado
        self.s.is_available = False
        self.s.error_message = None
        self.s._suspended_for_worker = False
        self.s._suspended_at = 0.0

    def tearDown(self):
        tasks.WORKER_LOGS_DIR = self.original_dir
        shutil.rmtree(self.dir, ignore_errors=True)

    def _conectar_com_dublê(self):
        """Roda _try_init com QdrantClient/_init_collection falsos e diz se conectou."""
        from src.search import semantic as mod
        original_client = mod.QdrantClient
        original_collection = self.cls._init_collection
        mod.QdrantClient = lambda path: "cliente-falso"
        self.cls._init_collection = lambda self: None
        try:
            self.s._try_init()
            return self.s.client is not None
        finally:
            mod.QdrantClient = original_client
            self.cls._init_collection = original_collection

    def test_suspensao_segura_durante_a_carencia(self):
        """Sem PID de worker visível ainda: a carência cobre o arranque do worker,
        que gasta ~15s carregando o modelo antes de abrir o Qdrant."""
        self.s.suspend_for_worker()
        self.assertFalse(self.s.is_available)
        self.assertFalse(self._conectar_com_dublê(), "servidor não pode retomar a trava")

    def test_suspensao_segura_enquanto_o_worker_vive(self):
        self.s.suspend_for_worker()
        self.s._suspended_at = time.time() - (self.cls.WORKER_HANDOFF_GRACE_S + 10)
        tasks.write_worker_pid("asr")  # nosso próprio PID: vivo
        self.assertFalse(self._conectar_com_dublê(), "worker vivo mantém a trava emprestada")

    def test_busca_volta_sozinha_quando_ninguem_mais_usa(self):
        """Carência vencida e nenhum worker vivo: a busca tem de voltar sem restart."""
        self.s.suspend_for_worker()
        self.s._suspended_at = time.time() - (self.cls.WORKER_HANDOFF_GRACE_S + 10)
        tasks.clear_worker_pid("asr")
        self.assertTrue(self._conectar_com_dublê(), "reconecta sozinha")
        self.assertFalse(self.s._suspended_for_worker)

    def test_indexacao_com_qdrant_fora_nao_derruba_a_transcricao(self):
        """Sem a guarda, client=None estourava AttributeError e o except externo de
        transcribe_video marcava o vídeo como 'error' -- depois do ASR já pago."""
        self.s.is_available = False
        self.s.client = None
        self.s.error_message = "trava emprestada"
        dialogos = [{"speaker_id": "A", "start_time": 0.0, "end_time": 1.0, "text": "oi"}]
        self.cls.index_transcript_chunks(self.s, 2, 13, dialogos)  # não pode levantar

    def test_get_instance_nao_cria_duas_sob_concorrencia(self):
        """Sem trava, duas threads criavam DUAS instâncias: a segunda falhava ao
        abrir o mesmo arquivo do Qdrant, e suspender uma não afetava a outra."""
        original_instance = self.cls._instance
        original_try_init = self.cls._try_init
        try:
            self.cls._instance = None
            self.cls._try_init = lambda self: time.sleep(0.05)  # alarga a janela da corrida

            obtidas = []
            threads = [threading.Thread(target=lambda: obtidas.append(self.cls.get_instance()))
                       for _ in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            self.assertEqual(len(obtidas), 8)
            self.assertEqual(len({id(o) for o in obtidas}), 1, "uma única instância para todas as threads")
        finally:
            self.cls._try_init = original_try_init
            self.cls._instance = original_instance


if __name__ == "__main__":
    unittest.main()
