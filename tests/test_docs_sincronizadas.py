"""Garante que as tabelas geradas nas docs estão em dia com o código."""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent


def _rodar(cmd):
    return subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True, encoding="utf-8", errors="replace")


def test_docs_api_em_dia():
    r = _rodar([sys.executable, "scripts/gerar_docs_api.py", "--check"])
    assert r.returncode == 0, (r.stdout + r.stderr)


@pytest.mark.skipif(shutil.which("node") is None, reason="node não encontrado")
def test_atalhos_em_dia():
    r = _rodar([shutil.which("node"), "scripts/gerar_atalhos.mjs", "--check"])
    assert r.returncode == 0, (r.stdout + r.stderr)
