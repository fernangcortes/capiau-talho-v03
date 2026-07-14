"""Gerenciador centralizado de tarefas em background, subprocessos e progresso."""
import os
import subprocess
import threading
from typing import Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor

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
        self._initialized = True

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

    def update_progress(self, task_key: str, percent: float, status: str, task_type: str = "conversion") -> None:
        """Atualiza de forma thread-safe o progresso de uma tarefa de conversão ou análise."""
        with self._lock:
            self.progress[task_key] = {
                "percent": percent,
                "status": status,
                "type": task_type
            }

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


# Instância global Singleton
TASK_MANAGER = TaskManager()
