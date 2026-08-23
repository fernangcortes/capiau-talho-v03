"""Gerenciador centralizado de tarefas em background, subprocessos e progresso."""
import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor

# Progresso espelhado em disco pelos workers de lote (src/worker_vision.py e
# src/worker_transcricao.py). Como eles rodam em processos separados do servidor,
# estes arquivos sao a unica forma da tela de Tarefas enxergar o andamento.
# Somem da tela quando ficam velhos demais.
# Ancorados na raiz do projeto (nao no CWD): worker e servidor precisam apontar
# para os MESMOS arquivos, independente de onde cada um foi iniciado.
#
# UM ARQUIVO POR TIPO (B1): cada worker grava o snapshot INTEIRO do seu progresso.
# Com um arquivo so, visao e transcricao rodando juntos apagavam as entradas um do
# outro a cada gravacao. read_worker_progress() mescla os arquivos na leitura.
WORKER_LOGS_DIR = Path(__file__).resolve().parents[2] / "data" / "logs"
WORKER_PROGRESS_PREFIX = "worker_progress_"
WORKER_PROGRESS_MAX_AGE_S = 600


def worker_progress_file(worker_type: str) -> Path:
    """Arquivo de progresso de um tipo de worker ('vision', 'asr')."""
    return WORKER_LOGS_DIR / f"{WORKER_PROGRESS_PREFIX}{worker_type}.json"


def worker_pid_file(worker_type: str) -> Path:
    """Arquivo de PID do worker, base da guarda de instancia unica (B2)."""
    return WORKER_LOGS_DIR / f"worker_{worker_type}.pid"


def _process_alive(pid: int) -> bool:
    """Diz se o PID esta vivo, sem depender de psutil (nao instalado aqui).

    ATENCAO: no Windows, os.kill(pid, 0) NAO e uma consulta -- o CPython cai em
    TerminateProcess e MATA o processo. Por isso a checagem usa OpenProcess.
    """
    if pid <= 0:
        return False
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

    import ctypes
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    STILL_ACTIVE = 259
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return False
    try:
        codigo = ctypes.c_ulong()
        if kernel32.GetExitCodeProcess(handle, ctypes.byref(codigo)):
            return codigo.value == STILL_ACTIVE
        return True
    finally:
        kernel32.CloseHandle(handle)


def write_worker_pid(worker_type: str, pid: Optional[int] = None) -> Path:
    """Registra o PID do worker. Chamado pelo proprio worker (cobre o lancamento
    manual pelo terminal) e pela rota que o lanca (fecha a janela de corrida entre
    o lancamento e o worker chegar a escrever)."""
    caminho = worker_pid_file(worker_type)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    dados = {"pid": pid if pid is not None else os.getpid(),
             "tipo": worker_type,
             "iniciado_em": time.time()}
    caminho.write_text(json.dumps(dados), encoding="utf-8")
    return caminho


def clear_worker_pid(worker_type: str, only_if_owner: bool = False) -> None:
    """Remove o registro ao fim da rodada. Falha aqui nao pode derrubar o worker.

    `only_if_owner` protege contra apagar o registro de OUTRO processo: um
    `--dry-run` rodando em paralelo a uma rodada real nao pode derrubar a guarda
    de instancia unica dela.
    """
    caminho = worker_pid_file(worker_type)
    try:
        if only_if_owner:
            if not caminho.exists():
                return
            dono = json.loads(caminho.read_text(encoding="utf-8")).get("pid")
            if int(dono) != os.getpid():
                return
        caminho.unlink(missing_ok=True)
    except Exception:
        pass


def worker_is_running(worker_type: str) -> Optional[Dict[str, Any]]:
    """Retorna os dados do worker em execucao, ou None se nao houver.

    Registro orfao (worker morto sem limpar) e apagado na hora, senao a guarda
    recusaria lancamentos para sempre.
    """
    caminho = worker_pid_file(worker_type)
    try:
        if not caminho.exists():
            return None
        dados = json.loads(caminho.read_text(encoding="utf-8"))
        pid = int(dados.get("pid", 0))
    except Exception:
        clear_worker_pid(worker_type)
        return None

    if not _process_alive(pid):
        clear_worker_pid(worker_type)
        return None

    dados["pid"] = pid
    dados["progress_file"] = str(worker_progress_file(worker_type))
    return dados

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
        self.paused_tasks: set = set()
        self._sink_path: Optional[Path] = None
        self._sink_last_write: float = 0.0
        self.last_user_activity: float = 0.0
        self._initialized = True

    def report_user_activity(self) -> None:
        """Reporta que o usuário realizou uma ação na timeline ou player."""
        self.last_user_activity = time.time()

    def is_user_active(self) -> bool:
        """Retorna True se houve atividade do usuário nos últimos 5 segundos."""
        return (time.time() - self.last_user_activity) < 5.0

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

    def add_log(self, task_key: str, message: str, level: str = "INFO") -> None:
        """Adiciona uma linha de log formatada com timestamp para a tarefa especificada e garante stdout no PowerShell."""
        import datetime
        now_str = datetime.datetime.now().strftime("%H:%M:%S")
        formatted = f"[{now_str}] [{level}] {message}"
        print(f"[TASK:{task_key}] {formatted}", flush=True)
        with self._lock:
            if task_key not in self.progress:
                self.progress[task_key] = {
                    "percent": 0.0,
                    "status": "running",
                    "type": "task",
                    "logs": []
                }
            elif "logs" not in self.progress[task_key] or not isinstance(self.progress[task_key]["logs"], list):
                self.progress[task_key]["logs"] = []

            logs = self.progress[task_key]["logs"]
            logs.append(formatted)
            if len(logs) > 300:
                self.progress[task_key]["logs"] = logs[-300:]
        self._flush_sink()

    def update_progress(self, task_key: str, percent: float, status: str, task_type: str = "conversion",
                        label: Optional[str] = None, log_message: Optional[str] = None) -> None:
        """Atualiza de forma thread-safe o progresso de uma tarefa e preserva o histórico de logs.

        'label' é o texto que a tela mostra; sem ele a tela deduz o nome pela mídia.
        """
        with self._lock:
            anterior = self.progress.get(task_key)
            existing_logs = anterior.get("logs", []) if anterior else []
            if not isinstance(existing_logs, list):
                existing_logs = []
            # Tarefa nova ou que mudou de estado (running/finished/failed) nao pode
            # ser engolida pela trava de 1s do espelho: e justamente o que a tela
            # precisa ver. A transcricao passa minutos sem atualizar percentual --
            # se a virada para 'running' se perdesse, a rodada inteira ficaria
            # invisivel na tela de Tarefas.
            estado_mudou = anterior is None or anterior.get("status") != status
            entry: Dict[str, Any] = {
                "percent": percent,
                "status": status,
                "type": task_type,
                "logs": existing_logs
            }
            if label:
                entry["label"] = label
            self.progress[task_key] = entry
        if log_message:
            self.add_log(task_key, log_message)
        else:
            self._flush_sink(force=estado_mudou)

    def remove_progress(self, task_key: str) -> None:
        """Remove o progresso de uma tarefa finalizada."""
        with self._lock:
            self.progress.pop(task_key, None)
            self.cancelled_tasks.discard(task_key)
            self.paused_tasks.discard(task_key)
        self._flush_sink(force=True)

    def pause_task(self, task_key: str) -> None:
        """Pausa uma tarefa em execução."""
        with self._lock:
            self.paused_tasks.add(task_key)
            if task_key in self.progress:
                self.progress[task_key]["status"] = "paused"
        self.add_log(task_key, "Tarefa pausada pelo usuário.", "WARN")

    def resume_task(self, task_key: str) -> None:
        """Retoma uma tarefa pausada."""
        with self._lock:
            self.paused_tasks.discard(task_key)
            if task_key in self.progress:
                self.progress[task_key]["status"] = "running"
        self.add_log(task_key, "Tarefa retomada.", "INFO")

    def cancel_task(self, task_key: str) -> None:
        """Cancela uma tarefa de segundo plano."""
        with self._lock:
            self.cancelled_tasks.add(task_key)
            self.paused_tasks.discard(task_key)
            if task_key in self.progress:
                self.progress[task_key]["status"] = "cancelled"
        self.add_log(task_key, "Tarefa cancelada pelo usuário.", "WARN")

    def is_cancelled(self, task_key: str) -> bool:
        """Verifica se a tarefa foi cancelada pelo usuário."""
        with self._lock:
            return task_key in self.cancelled_tasks


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
    """Mescla o progresso de todos os workers de lote, que rodam em outros processos.

    Ignora arquivo velho, um por um: se um worker morreu ou terminou, a tela nao
    pode ficar mostrando aquela rodada fantasma para sempre -- mas o outro, que
    talvez ainda esteja rodando, continua aparecendo.

    Colisao de chave: transcricao e visao usam str(video_id) como chave de
    progresso (src/services/pipeline.py:349 e :649). Se o MESMO video estiver nos
    dois workers ao mesmo tempo, o segundo entra como "<id>#<tipo>" em vez de
    sumir. Perde a miniatura na tela de Tarefas, mas nao perde a tarefa.
    """
    mesclado: Dict[str, Dict[str, Any]] = {}
    agora = time.time()
    try:
        arquivos = sorted(WORKER_LOGS_DIR.glob(f"{WORKER_PROGRESS_PREFIX}*.json"))
    except Exception:
        return {}

    for arquivo in arquivos:
        tipo = arquivo.stem[len(WORKER_PROGRESS_PREFIX):] or "worker"
        try:
            if (agora - arquivo.stat().st_mtime) > WORKER_PROGRESS_MAX_AGE_S:
                continue
            dados = json.loads(arquivo.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(dados, dict):
            continue
        for chave, valor in dados.items():
            mesclado[chave if chave not in mesclado else f"{chave}#{tipo}"] = valor

    return mesclado


# Instância global Singleton
TASK_MANAGER = TaskManager()
