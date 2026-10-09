"""Servidor estático local para os relatórios HTML em data/, com suporte a Range.

O `python -m http.server` responde sempre 200 com o arquivo inteiro: o navegador toca o
proxy, mas não consegue pular para um ponto do vídeo. Este responde 206 ao cabeçalho Range,
então os botões de "pular para" dos relatórios funcionam.

Uso:
    .venv\\Scripts\\python.exe scripts\\servir_relatorios.py [porta]   (padrão 8771)
    abrir http://127.0.0.1:8771/cache/plano_sequencia/candidatos.html
"""
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1] / "data"


class ComRange(SimpleHTTPRequestHandler):
    def send_head(self):
        faixa = self.headers.get("Range")
        caminho = self.translate_path(self.path)
        m = re.match(r"bytes=(\d*)-(\d*)$", faixa or "")
        if not m or not os.path.isfile(caminho):
            return super().send_head()
        tamanho = os.path.getsize(caminho)
        ini = int(m.group(1)) if m.group(1) else max(0, tamanho - int(m.group(2) or 0))
        fim = int(m.group(2)) if m.group(1) and m.group(2) else tamanho - 1
        fim = min(fim, tamanho - 1)
        if ini > fim:
            self.send_error(416)
            return None
        f = open(caminho, "rb")
        f.seek(ini)
        self.send_response(206)
        self.send_header("Content-type", self.guess_type(caminho))
        self.send_header("Content-Range", f"bytes {ini}-{fim}/{tamanho}")
        self.send_header("Content-Length", str(fim - ini + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self._resto = fim - ini + 1
        return f

    def copyfile(self, origem, destino):
        resto = getattr(self, "_resto", None)
        if resto is None:
            return super().copyfile(origem, destino)
        try:
            while resto > 0:
                bloco = origem.read(min(1 << 20, resto))
                if not bloco:
                    break
                destino.write(bloco)
                resto -= len(bloco)
        except (BrokenPipeError, ConnectionResetError):
            pass  # o navegador cancela pedidos de trecho o tempo todo ao pular
        finally:
            self._resto = None

    def end_headers(self):
        if not self.headers.get("Range"):
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def log_message(self, *args):
        pass


def main() -> int:
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8771
    servidor = ThreadingHTTPServer(("127.0.0.1", porta), partial(ComRange, directory=str(RAIZ)))
    print(f"Servindo {RAIZ} em http://127.0.0.1:{porta}/")
    servidor.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
