"""Lanca um processo verdadeiramente desgrudado do console (Windows).

Por que existe: `Start-Process -WindowStyle Hidden` (PowerShell) ESCONDE a janela
mas nao desgruda o processo do console de quem o lancou de verdade. Se aquele
console fechar, o Windows manda CTRL_CLOSE_EVENT para tudo que ainda esta preso
a ele -- e o runtime Fortran/MKL do PyTorch aborta na hora
("forrtl: error (200): program aborting due to window-CLOSE event").
Foi o que matou o worker de visao e o servidor juntos, no mesmo minuto, em
16/07/2026 as 03:30, depois de ~36h rodando sem problema.

DETACHED_PROCESS (0x00000008) diz ao Windows: este processo nunca tem console.
Nao ha janela para fechar, entao nao ha sinal para receber. Nao instala nada
persistente (ao contrario de uma Tarefa Agendada) -- e so uma flag na criacao
do processo.

Uso:
    python scripts/launch_detached.py <argv...> --stdout <arquivo> --stderr <arquivo>
"""
import subprocess
import sys
from pathlib import Path

DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200


def main() -> None:
    args = sys.argv[1:]
    if "--stdout" not in args or "--stderr" not in args:
        print("Uso: launch_detached.py <argv...> --stdout <arquivo> --stderr <arquivo>", file=sys.stderr)
        sys.exit(1)

    out_idx = args.index("--stdout")
    err_idx = args.index("--stderr")
    stdout_path = Path(args[out_idx + 1])
    stderr_path = Path(args[err_idx + 1])
    cmd = args[:min(out_idx, err_idx)]

    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    stderr_path.parent.mkdir(parents=True, exist_ok=True)

    out = open(stdout_path, "ab")
    err = open(stderr_path, "ab")
    proc = subprocess.Popen(
        cmd,
        stdout=out,
        stderr=err,
        stdin=subprocess.DEVNULL,
        creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )
    print(f"PID: {proc.pid}")


if __name__ == "__main__":
    main()
