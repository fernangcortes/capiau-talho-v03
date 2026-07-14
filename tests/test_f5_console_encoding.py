"""Proteção contra logs que derrubam o pipeline em console cp1252 (Windows).

O console desta máquina usa cp1252, que não codifica '→', '≤', emojis etc.
Um print com esses caracteres levanta UnicodeEncodeError; quando o print está
dentro de um try/except amplo (padrão comum no pipeline), o erro é engolido e a
função cai no caminho de fallback — a análise degrada silenciosamente.

Aconteceu de verdade em analyze_video_vision: o log de segmentação com '→'
descartava os keyframes e rebaixava tudo para o relógio fixo de 10s.
"""
import ast
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

SRC = Path(__file__).parent.parent / "src"
LOG_FUNCS = {"print", "debug", "info", "warning", "error", "critical", "exception"}


def _unencodable(text: str, encoding: str = "cp1252") -> str:
    bad = []
    for ch in text:
        try:
            ch.encode(encoding)
        except UnicodeEncodeError:
            bad.append(ch)
    return "".join(dict.fromkeys(bad))


class TestConsoleEncoding(unittest.TestCase):
    def test_nenhum_log_usa_caractere_impossivel_em_cp1252(self):
        """Literais de print/log devem ser codificáveis no console legado do Windows."""
        offenders = []
        for file in SRC.rglob("*.py"):
            tree = ast.parse(file.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
                if name not in LOG_FUNCS:
                    continue
                for sub in ast.walk(node):
                    if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                        bad = _unencodable(sub.value)
                        if bad:
                            rel = file.relative_to(SRC.parent.parent)
                            offenders.append(f"{rel}:{sub.lineno} contém {ascii(bad)}")

        self.assertEqual(
            offenders, [],
            "Log com caractere fora do cp1252 (use '->' em vez de '→', '<=' em vez de '≤', "
            "e nada de emoji). Isso quebra o console do Windows:\n  " + "\n  ".join(offenders),
        )

    def test_make_console_crash_proof_evita_unicodeencodeerror(self):
        """A rede de segurança: mesmo um log inesperado não pode levantar exceção."""
        from src.core.logging import make_console_crash_proof

        stream = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="strict")
        original = sys.stdout
        sys.stdout = stream
        try:
            with self.assertRaises(UnicodeEncodeError, msg="pré-condição: cp1252 estrito quebra"):
                print("segmentos → keyframes ≤10s 🎉")
                stream.flush()

            make_console_crash_proof()
            print("segmentos → keyframes ≤10s 🎉")  # não pode levantar
            stream.flush()
        finally:
            sys.stdout = original

        self.assertEqual(stream.errors, "replace", "o stream deve passar a substituir o incodificável")

    def test_reconfigure_preserva_acentuacao(self):
        """A rede de segurança não pode virar mojibake: acento existe em cp1252."""
        from src.core.logging import make_console_crash_proof

        stream = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="strict")
        original = sys.stdout
        sys.stdout = stream
        try:
            make_console_crash_proof()
            print("análise de vídeo concluída: segmentação e visão")
            stream.flush()
        finally:
            sys.stdout = original

        written = stream.buffer.getvalue().decode("cp1252")
        self.assertIn("análise de vídeo concluída: segmentação e visão", written)

    def test_stream_sem_reconfigure_nao_quebra(self):
        """Sob pytest/pipes o stdout pode não ter reconfigure — não pode explodir."""
        from src.core.logging import make_console_crash_proof

        original_out, original_err = sys.stdout, sys.stderr
        sys.stdout = io.StringIO()   # StringIO não tem reconfigure()
        sys.stderr = io.StringIO()
        try:
            make_console_crash_proof()  # não deve levantar
        finally:
            sys.stdout, sys.stderr = original_out, original_err


if __name__ == "__main__":
    unittest.main()
