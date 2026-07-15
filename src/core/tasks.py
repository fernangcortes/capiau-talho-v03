"""Gerenciador centralizado de tarefas em background, subprocessos e progresso."""
import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor

# Progresso espelhado em disco pelo worker de lote (src/worker_vision.py). Como ele
# roda num processo separado do servidor, este arquivo e a unica forma da tela de
# Tarefas enxergar o andamento da rodada. Some da tela quando fica velho demais.
# Ancorado na raiz do projeto (nao no CWD): worker e servidor precisam apontar para
# o MESMO arquivo, independente de onde cada um foi iniciado.
WORKER_PROGRESS_FILE = Path(__file__).resolve().parents[2] / "data" / "logs" / "worker_progress.json"
WORKER_PROGRESS_MAX_AGE_S = 600

class TaskManager:
    _instance: Optional["TaskManager"] = None
    _lock = threading.Lock()

    def __new__(cls, *args: Any, **kwargs: Any) -> "TaskManager":
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self, max_workers: Optional[int] = None) -> None:
        if self._initialized:
            return
        self._lock = threading.Lock()
        from src.config import CONFIG
        workers = max_workers if max_workers is not None else CONFIG.MAX_CONVERSION_WORKERS
        self.executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="capiau-worker")
        self.active_processes: Dict[int, subprocess.Popen] = {}
        self.progress: Dict[str, Dict[str, Any]] = {}
        self.active_clustering: set = set()
        self.cancelled_tasks: set = set()
        self._sink_path: Optional[Path] = None
        self._sink_last_write: float = 0.0
        self._initialized = True

    def enable_file_sink(self, path: Path) -> None:
        """Passa a espelhar o progresso num arquivo, para OUTRO processo poder ler.

        Usado pelo worker de lote: como ele roda fora do servidor, sem isso a tela
        de Tarefas ficaria vazia durante toda a rodada.
        """
        with self._lock:
            self._sink_path = Path(path)
            self._sink_path.parent.mkdir(parents=True, exist_ok=True)
            self._sink_last_write = 0.0
        self._flush_sink(force=True)

    def _flush_sink(self, force: bool = False) -> None:
        """Grava o progresso no arquivo espelho. Nunca levanta: progresso e cosmetico
        e não pode derrubar o lote (mesma licao do bug de log do E2.A5)."""
        if self._sink_path is None:
            return
        now = time.monotonic()
        with self._lock:
            if not force and (now - self._sink_last_write) < 1.0:
                return
            self._sink_last_write = now
            snapshot = dict(self.progress)
            path = self._sink_path
        try:
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(snapshot), encoding="utf-8")
            os.replace(tmp, path)  # troca atomica: o leitor nunca ve JSON pela metade
        except Exception:
            pass

    def register_process(self, video_id: int, process: subprocess.Popen) -> None:
        """Registra um processo FFmpeg ativo associado a um vídeo."""
        with self._lock:
            self.active_processes[video_id] = process

    def unregister_process(self, video_id: int) -> None:
        """Remove o registro de um processo FFmpeg concluído ou cancelado."""
        with self._lock:
            self.active_processes.pop(video_id, None)

    def cancel_process(self, video_id: int) -> bool:
        """Cancela um processo ativo de forma limpa matando a árvore de processos no Windows/Linux."""
        with self._lock:
            process = self.active_processes.pop(video_id, None)
        
        if not process:
            return False
            
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(process.pid)], capture_output=True)
            else:
                process.kill()
            process.wait(timeout=2)
            return True
        except Exception as e:
            # Logger pode ser usado aqui após configurar a camada de log
            print(f"[TaskManager] Erro ao encerrar processo FFmpeg do vídeo {video_id}: {e}")
            return False

    def update_progress(self, task_key: str, percent: float, status: str, task_type: str = "conversion",
                        label: Optional[str] = None) -> None:
        """Atualiza de forma thread-safe o progresso de uma tarefa de conversão ou análise.

        'label' é o texto que a tela mostra; sem ele a tela deduz o nome pela mídia.
        """
        with self._lock:
            entry: Dict[str, Any] = {
                "percent": percent,
                "status": status,
                "type": task_type
            }
            if label:
                entry["label"] = label
            self.progress[task_key] = entry
        self._flush_sink()

    def remove_progress(self, task_key: str) -> None:
        """Remove o progresso de uma tarefa finalizada."""
        with self._lock:
            self.progress.pop(task_key, None)

    def get_progress(self) -> Dict[str, Dict[str, Any]]:
        """Retorna uma cópia do dicionário de progresso de todas as tarefas."""
        with self._lock:
            res = self.progress.copy()
            for pid in self.active_clustering:
                res[f"cluster-{pid}"] = {"status": "running", "percent": 0.0, "type": "clustering"}
            return res

    def register_clustering(self, project_id: int) -> None:
        """Registra o início de uma tarefa de clustering de temas."""
        with self._lock:
            self.active_clustering.add(project_id)

    def unregister_clustering(self, project_id: int) -> None:
        """Remove o registro de clustering de temas concluído."""
        with self._lock:
            self.active_clustering.discard(project_id)

    def cleanup(self) -> None:
        """Finaliza todos os subprocessos ativos para evitar órfãos (ex: FFmpeg)."""
        with self._lock:
            processes = list(self.active_processes.items())
            self.active_processes.clear()
            
        for video_id, process in processes:
            try:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/F', '/T', '/PID', str(process.pid)], capture_output=True)
                else:
                    process.kill()
            except Exception:
                pass


def read_worker_progress() -> Dict[str, Dict[str, Any]]:
    """Le o progresso do worker de lote, que roda em processo separado.

    Ignora arquivo velho: se o worker morreu ou terminou, a tela nao pode ficar
    mostrando uma rodada fantasma para sempre.
    """
    try:
        if not WORKER_PROGRESS_FILE.exists():
            return {}
        if (time.time() - WORKER_PROGRESS_FILE.stat().st_mtime) > WORKER_PROGRESS_MAX_AGE_S:
            return {}
        return json.loads(WORKER_PROGRESS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


# Instância global Singleton
TASK_MANAGER = TaskManager()
