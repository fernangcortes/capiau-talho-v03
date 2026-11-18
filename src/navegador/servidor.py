"""Servidor HTTP local em loopback (`127.0.0.1`) para o navegador headless.

Fornece origem segura (`http://127.0.0.1:<porta>/<token>/...`, destravando
`AudioWorklet` e APIs que exigem `window.isSecureContext === true`), suporte a
`GET`/`HEAD` com `Range` (necessário para `<video>`/`<audio>` e WAVs grandes) e
`PUT`/`POST` atômico em disco para devolução de áudio/dados sem base64 via CDP.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import secrets
import shutil
import tempfile
import threading
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Tuple
from urllib.parse import quote, unquote, urlparse

# Nomes reservados do sistema de arquivos Windows (independentemente de extensão).
_NOMES_RESERVADOS_WIN = frozenset({
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
})

_RE_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")

_MIME_EXPLICITO: Dict[str, str] = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
}

_BLOCO_IO = 64 * 1024  # 64 KiB


def _mime_para(caminho: Path) -> str:
    ext = caminho.suffix.lower()
    if ext in _MIME_EXPLICITO:
        return _MIME_EXPLICITO[ext]
    tipo, _ = mimetypes.guess_type(caminho.name)
    return tipo or "application/octet-stream"


def _segmento_seguro(seg: str) -> bool:
    """Valida um único segmento de caminho contra travessia e nomes perigosos."""
    if not seg or seg in (".", ".."):
        return False
    if any(ord(ch) < 32 for ch in seg):
        return False
    if any(ch in seg for ch in ("\\", "/", ":", "\x00")):
        return False
    if "$" in seg and "::$DATA" in seg.upper():
        return False
    base = seg.split(".", 1)[0].strip().upper()
    if base in _NOMES_RESERVADOS_WIN:
        return False
    return True


def _validar_nome_arquivo(nome: str) -> str:
    texto = str(nome or "").strip()
    if not _segmento_seguro(texto):
        raise ValueError(f"Nome de arquivo inseguro ou inválido: {nome!r}")
    return texto


def _extrair_segmentos_relativos(bruto: str) -> Optional[Tuple[str, ...]]:
    """Converte path URL decodificado em tupla de segmentos seguros, ou None se inválido."""
    if "\x00" in bruto or "\\" in bruto:
        return None
    # Antes e depois de unquote, proibir %2e%2e / .. / drive / ADS
    decodificado = unquote(bruto)
    if "\x00" in decodificado or "\\" in decodificado:
        return None
    if "::" in decodificado:
        return None
    partes = [p for p in decodificado.split("/") if p != ""]
    for seg in partes:
        if not _segmento_seguro(seg):
            return None
    return tuple(partes)


def _resolver_em_pasta(pasta_base: Path, segmentos: Tuple[str, ...]) -> Optional[Path]:
    """Resolve `pasta_base / segmentos` garantindo confinamento estrito mesmo com symlinks."""
    if not segmentos:
        return None
    base_resolvida = pasta_base.resolve()
    alvo = base_resolvida
    for seg in segmentos:
        alvo = alvo / seg
    try:
        resolvido = alvo.resolve(strict=True)
    except OSError:
        return None
    if resolvido == base_resolvida or base_resolvida not in resolvido.parents:
        return None
    if not resolvido.is_file():
        return None
    return resolvido


@dataclass(frozen=True)
class Saida:
    """Destino reservado para upload (`PUT`/`POST`) feito pela página."""

    url: str
    caminho: Path

    def recebida(self) -> bool:
        return self.caminho.is_file()

    def tamanho(self) -> int:
        try:
            return self.caminho.stat().st_size if self.caminho.is_file() else 0
        except OSError:
            return 0


class _HTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class ServidorLocal:
    """Servidor HTTP/1.1 em `127.0.0.1:<porta>/<token>/...` com vida curta."""

    def __init__(self, pasta_saidas: Optional[Path] = None) -> None:
        self._token = secrets.token_urlsafe(18)
        self._lock = threading.RLock()
        self._rotas: Dict[str, Tuple[str, Any]] = {}
        self._saidas: Dict[str, Dict[str, Any]] = {}
        self._encerrado = False
        self._tmpdir: Optional[tempfile.TemporaryDirectory] = None
        if pasta_saidas is not None:
            self._pasta_saidas = Path(pasta_saidas)
            self._pasta_saidas.mkdir(parents=True, exist_ok=True)
        else:
            self._tmpdir = tempfile.TemporaryDirectory(prefix="capiau_nav_srv_")
            self._pasta_saidas = Path(self._tmpdir.name)

        servidor_pai = self

        class _Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
                return

            def _responder_erro(self, status: int, mensagem: str,
                                 headers_extra: Optional[Dict[str, str]] = None,
                                 fechar_conexao: bool = False) -> None:
                corpo = json.dumps({"detail": mensagem}).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(corpo)))
                self.send_header("Cache-Control", "no-store")
                if headers_extra:
                    for k, v in headers_extra.items():
                        self.send_header(k, v)
                if fechar_conexao:
                    self.send_header("Connection", "close")
                    self.close_connection = True
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(corpo)

            def _validar_requisicao(self) -> Optional[Tuple[str, ...]]:
                if self.client_address[0] != "127.0.0.1":
                    self._responder_erro(HTTPStatus.FORBIDDEN, "Cliente fora de loopback.", fechar_conexao=True)
                    return None
                host = (self.headers.get("Host") or "").strip().lower()
                if host not in (f"127.0.0.1:{servidor_pai.porta}", "127.0.0.1"):
                    self._responder_erro(HTTPStatus.FORBIDDEN, "Host não permitido.", fechar_conexao=True)
                    return None
                parsed = urlparse(self.path)
                segs = _extrair_segmentos_relativos(parsed.path)
                if segs is None or not segs or segs[0] != servidor_pai._token:
                    self._responder_erro(HTTPStatus.NOT_FOUND, "Não encontrado.")
                    return None
                return segs[1:]

            def _servir_arquivo(self, caminho: Path, apenas_cabecalhos: bool) -> None:
                try:
                    st = caminho.stat()
                except OSError:
                    self._responder_erro(HTTPStatus.NOT_FOUND, "Arquivo ausente.")
                    return
                total = st.st_size
                mime = _mime_para(caminho)
                range_hdr = self.headers.get("Range")
                inicio = 0
                fim = total - 1 if total > 0 else 0
                status = HTTPStatus.OK

                if range_hdr is not None:
                    if total == 0:
                        self._responder_erro(
                            HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
                            "Intervalo inválido em arquivo vazio.",
                            headers_extra={"Content-Range": "bytes */0"},
                        )
                        return
                    m = _RE_RANGE.match(range_hdr.strip())
                    if not m:
                        self._responder_erro(
                            HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
                            "Cabeçalho Range inválido.",
                            headers_extra={"Content-Range": f"bytes */{total}"},
                        )
                        return
                    a, b = m.group(1), m.group(2)
                    if not a and not b:
                        self._responder_erro(
                            HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
                            "Range vazio.",
                            headers_extra={"Content-Range": f"bytes */{total}"},
                        )
                        return
                    if a == "":
                        sufixo = int(b)
                        if sufixo <= 0:
                            self._responder_erro(
                                HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
                                "Sufixo de Range inválido.",
                                headers_extra={"Content-Range": f"bytes */{total}"},
                            )
                            return
                        inicio = max(0, total - sufixo)
                        fim = total - 1
                    else:
                        inicio = int(a)
                        fim = int(b) if b != "" else total - 1
                        if inicio >= total or fim < inicio:
                            self._responder_erro(
                                HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
                                "Range fora dos limites.",
                                headers_extra={"Content-Range": f"bytes */{total}"},
                            )
                            return
                        fim = min(fim, total - 1)
                    status = HTTPStatus.PARTIAL_CONTENT

                tamanho_resp = (fim - inicio + 1) if total > 0 else 0
                self.send_response(status)
                self.send_header("Content-Type", mime)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(tamanho_resp))
                self.send_header("Cache-Control", "no-store")
                if status == HTTPStatus.PARTIAL_CONTENT:
                    self.send_header("Content-Range", f"bytes {inicio}-{fim}/{total}")
                self.end_headers()

                if apenas_cabecalhos or tamanho_resp == 0:
                    return
                with caminho.open("rb") as fh:
                    fh.seek(inicio)
                    restante = tamanho_resp
                    while restante > 0:
                        bloco = fh.read(min(_BLOCO_IO, restante))
                        if not bloco:
                            break
                        self.wfile.write(bloco)
                        restante -= len(bloco)

            def _tratar_leitura(self, apenas_cabecalhos: bool) -> None:
                segs = self._validar_requisicao()
                if segs is None:
                    return
                if not segs:
                    self._responder_erro(HTTPStatus.NOT_FOUND, "Prefixo ausente.")
                    return

                prefixo = segs[0]
                resto = segs[1:]
                with servidor_pai._lock:
                    rota = servidor_pai._rotas.get(prefixo)
                if rota is None:
                    self._responder_erro(HTTPStatus.NOT_FOUND, "Rota não encontrada.")
                    return

                tipo, payload = rota
                if tipo == "pasta":
                    arquivo = _resolver_em_pasta(payload, resto)
                    if arquivo is None:
                        self._responder_erro(HTTPStatus.NOT_FOUND, "Arquivo não encontrado.")
                        return
                    self._servir_arquivo(arquivo, apenas_cabecalhos)
                elif tipo == "arquivo":
                    caminho_arq: Path = payload
                    if resto and (len(resto) != 1 or resto[0] != caminho_arq.name):
                        self._responder_erro(HTTPStatus.NOT_FOUND, "Arquivo não encontrado.")
                        return
                    if not caminho_arq.is_file():
                        self._responder_erro(HTTPStatus.NOT_FOUND, "Arquivo indisponível.")
                        return
                    self._servir_arquivo(caminho_arq, apenas_cabecalhos)
                elif tipo == "mapa":
                    if len(resto) != 1 or resto[0] not in payload:
                        self._responder_erro(HTTPStatus.NOT_FOUND, "Item não encontrado.")
                        return
                    alvo: Path = payload[resto[0]]
                    if not alvo.is_file():
                        self._responder_erro(HTTPStatus.NOT_FOUND, "Arquivo ausente.")
                        return
                    self._servir_arquivo(alvo, apenas_cabecalhos)
                elif tipo == "json":
                    if resto:
                        self._responder_erro(HTTPStatus.NOT_FOUND, "Recurso não encontrado.")
                        return
                    corpo: bytes = payload
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(corpo)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    if not apenas_cabecalhos:
                        self.wfile.write(corpo)
                else:
                    self._responder_erro(HTTPStatus.NOT_FOUND, "Rota inválida.")

            def _tratar_escrita(self) -> None:
                segs = self._validar_requisicao()
                if segs is None:
                    return
                if len(segs) != 3 or segs[0] != "_saidas":
                    self._responder_erro(HTTPStatus.NOT_FOUND, "Destino de escrita inválido.")
                    return
                chave_saida = f"{segs[1]}/{segs[2]}"
                with servidor_pai._lock:
                    info = servidor_pai._saidas.get(chave_saida)
                if info is None:
                    self._responder_erro(HTTPStatus.NOT_FOUND, "Saída não reservada.")
                    return

                limite_bytes = int(info["limite_bytes"])
                destino: Path = info["caminho"]

                cl_raw = self.headers.get("Content-Length")
                if cl_raw is None:
                    self._responder_erro(
                        HTTPStatus.LENGTH_REQUIRED,
                        "Content-Length obrigatório.",
                        fechar_conexao=True,
                    )
                    return
                try:
                    content_length = int(cl_raw)
                except ValueError:
                    self._responder_erro(HTTPStatus.BAD_REQUEST, "Content-Length inválido.", fechar_conexao=True)
                    return
                if content_length < 0:
                    self._responder_erro(HTTPStatus.BAD_REQUEST, "Content-Length negativo.", fechar_conexao=True)
                    return
                if content_length > limite_bytes:
                    self._responder_erro(
                        HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                        f"Payload excede o limite de {limite_bytes} bytes.",
                        fechar_conexao=True,
                    )
                    return

                destino.parent.mkdir(parents=True, exist_ok=True)
                parcial = destino.with_name(f".{destino.name}.{secrets.token_hex(6)}.parcial")
                recebido = 0
                try:
                    with parcial.open("wb") as fh:
                        while recebido < content_length:
                            pedir = min(_BLOCO_IO, content_length - recebido)
                            chunk = self.rfile.read(pedir)
                            if not chunk:
                                raise EOFError("Conexão encerrada antes do término do corpo.")
                            recebido += len(chunk)
                            if recebido > limite_bytes:
                                raise OverflowError("Limite excedido durante streaming.")
                            fh.write(chunk)
                    os.replace(parcial, destino)
                except OverflowError:
                    parcial.unlink(missing_ok=True)
                    self._responder_erro(
                        HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                        f"Payload excede o limite de {limite_bytes} bytes.",
                        fechar_conexao=True,
                    )
                    return
                except Exception as exc:
                    parcial.unlink(missing_ok=True)
                    self._responder_erro(HTTPStatus.BAD_REQUEST, f"Falha ao gravar saída: {exc}", fechar_conexao=True)
                    return

                resp = json.dumps({"ok": True, "bytes": recebido}).encode("utf-8")
                self.send_response(HTTPStatus.CREATED)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(resp)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(resp)

            def do_GET(self) -> None:
                self._tratar_leitura(apenas_cabecalhos=False)

            def do_HEAD(self) -> None:
                self._tratar_leitura(apenas_cabecalhos=True)

            def do_PUT(self) -> None:
                self._tratar_escrita()

            def do_POST(self) -> None:
                self._tratar_escrita()

        self._srv = _HTTPServer(("127.0.0.1", 0), _Handler)
        self.porta: int = int(self._srv.server_address[1])
        self._url_base = f"http://127.0.0.1:{self.porta}/{self._token}"
        self._thread = threading.Thread(
            target=self._srv.serve_forever,
            kwargs={"poll_interval": 0.1},
            name=f"capiau-nav-http-{self.porta}",
            daemon=True,
        )
        self._thread.start()

    @property
    def url_base(self) -> str:
        return self._url_base

    def _normalizar_prefixo(self, prefixo: str) -> str:
        limpo = str(prefixo or "").strip().strip("/")
        if not _segmento_seguro(limpo) or limpo == "_saidas":
            raise ValueError(f"Prefixo inválido: {prefixo!r}")
        return limpo

    def publicar_pasta(self, prefixo: str, pasta: Path) -> str:
        chave = self._normalizar_prefixo(prefixo)
        alvo = Path(pasta).resolve()
        if not alvo.is_dir():
            raise FileNotFoundError(f"Pasta não encontrada: {alvo}")
        with self._lock:
            self._rotas[chave] = ("pasta", alvo)
        return f"{self._url_base}/{chave}"

    def publicar_arquivo(self, prefixo: str, caminho: Path) -> str:
        chave = self._normalizar_prefixo(prefixo)
        alvo = Path(caminho).resolve()
        if not alvo.is_file():
            raise FileNotFoundError(f"Arquivo não encontrado: {alvo}")
        with self._lock:
            self._rotas[chave] = ("arquivo", alvo)
        return f"{self._url_base}/{chave}/{quote(alvo.name)}"

    def publicar_mapa(self, prefixo: str, arquivos: Mapping[str, Path]) -> str:
        chave = self._normalizar_prefixo(prefixo)
        mapa: Dict[str, Path] = {}
        for nome, caminho in arquivos.items():
            nome_limpo = _validar_nome_arquivo(nome)
            mapa[nome_limpo] = Path(caminho).resolve()
        with self._lock:
            self._rotas[chave] = ("mapa", mapa)
        return f"{self._url_base}/{chave}"

    def reservar_saida(self, nome: str, *, limite_bytes: int = 1 << 30) -> Saida:
        nome_seg = _validar_nome_arquivo(nome)
        id_seg = secrets.token_hex(6)
        destino = (self._pasta_saidas / id_seg / nome_seg).resolve()
        destino.parent.mkdir(parents=True, exist_ok=True)
        chave_saida = f"{id_seg}/{nome_seg}"
        with self._lock:
            self._saidas[chave_saida] = {
                "caminho": destino,
                "limite_bytes": max(0, int(limite_bytes)),
            }
        url = f"{self._url_base}/_saidas/{id_seg}/{quote(nome_seg)}"
        return Saida(url=url, caminho=destino)

    def responder_json(self, prefixo: str, corpo: Any) -> str:
        chave = self._normalizar_prefixo(prefixo)
        dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
        with self._lock:
            self._rotas[chave] = ("json", dados)
        return f"{self._url_base}/{chave}"

    def parar(self) -> None:
        with self._lock:
            if self._encerrado:
                return
            self._encerrado = True
        try:
            self._srv.shutdown()
        except Exception:
            pass
        try:
            self._srv.server_close()
        except Exception:
            pass
        if self._thread.is_alive():
            self._thread.join(timeout=3.0)
        if self._tmpdir is not None:
            try:
                self._tmpdir.cleanup()
            except Exception:
                shutil.rmtree(self._tmpdir.name, ignore_errors=True)

    def __enter__(self) -> "ServidorLocal":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.parar()
